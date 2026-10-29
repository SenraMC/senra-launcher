const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } = require('electron')
const autoUpdater                       = require('electron-updater').autoUpdater
const ejse                              = require('ejs-electron')
const fs                                = require('fs')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const semver                            = require('semver')
const { pathToFileURL }                 = require('url')
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')

// Setup Lang
LangLoader.setupLanguage()

// Senra : jamais d'envoi vers une fenêtre déjà fermée (à la fermeture du launcher, une erreur de mise à jour
// faisait apparaître « Object has been destroyed »)
function envoyerMaj(event, ...args) {
    if(!event.sender.isDestroyed()){
        event.sender.send('autoUpdateNotification', ...args)
    }
}

// Senra (Linux) : la mise à jour automatique ne marche que pour l'AppImage lancé depuis son fichier, ou le .deb.
// Installé autrement (AppImage décompressé ou déplacé par un outil), on vérifie quand même la dernière version sur GitHub
// et on propose de la télécharger.
function majAutoPossible() {
    if(process.platform !== 'linux' || process.env.APPIMAGE){
        return true
    }
    try {
        return ['deb', 'rpm', 'pacman'].includes(fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim())
    } catch(err) {
        return false
    }
}

async function verifierMajManuelle(event) {
    try {
        const reponse = await fetch('https://api.github.com/repos/SenraMC/senra-launcher/releases/latest', { headers: { 'User-Agent': 'senra-launcher' } })
        const derniere = (await reponse.json()).tag_name.replace(/^v/, '')
        if(semver.valid(derniere) && semver.gt(derniere, app.getVersion())){
            envoyerMaj(event, 'update-available', { version: derniere, manuel: true, lien: 'https://github.com/SenraMC/senra-launcher/releases/latest' })
            return
        }
    } catch(err) {
        console.log('Vérification de la dernière version impossible', err)
    }
    envoyerMaj(event, 'update-not-available', {})
}

// Senra (Linux, AppImage) : raccourci dans le menu des applications (refait à chaque lancement : le chemin change
// à chaque mise à jour), et une fois sur le bureau
function integrerAppImage() {
    if(process.platform !== 'linux' || !process.env.APPIMAGE){
        return
    }
    try {
        const os = require('os')
        const maison = os.homedir()
        const icones = path.join(maison, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps')
        const applis = path.join(maison, '.local', 'share', 'applications')
        fs.mkdirSync(icones, { recursive: true })
        fs.mkdirSync(applis, { recursive: true })
        fs.copyFileSync(path.join(__dirname, 'app', 'assets', 'images', 'SenraIcon.png'), path.join(icones, 'senra-launcher.png'))
        const entree = [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Senra Launcher',
            'Comment=Launcher du serveur Senra Naruto RP',
            `Exec="${process.env.APPIMAGE}" %U`,
            'Icon=senra-launcher',
            'Terminal=false',
            'Categories=Game;',
            ''
        ].join('\n')
        fs.writeFileSync(path.join(applis, 'senra-launcher.desktop'), entree, { mode: 0o755 })
        const marque = path.join(app.getPath('userData'), 'raccourci-bureau-cree')
        if(!fs.existsSync(marque)){
            let bureau = path.join(maison, 'Desktop')
            try {
                bureau = require('child_process').execFileSync('xdg-user-dir', ['DESKTOP']).toString().trim() || bureau
            } catch(err) {
                // pas de xdg-user-dir : ~/Desktop
            }
            if(fs.existsSync(bureau)){
                fs.writeFileSync(path.join(bureau, 'senra-launcher.desktop'), entree, { mode: 0o755 })
            }
            fs.writeFileSync(marque, '')
        }
    } catch(err) {
        console.log('Raccourci Linux impossible', err)
    }
}

// Setup auto updater.
function initAutoUpdater(event, data) {

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    // Senra : rien n'est téléchargé tant que le joueur n'a pas accepté la mise à jour, et rien ne s'installe en quittant
    // (l'installation se fait quand il clique ; en quittant, une installation impossible, ex. Linux, finissait en erreur)
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('update-available', (info) => envoyerMaj(event, 'update-available', info))
    autoUpdater.on('download-progress', (progres) => envoyerMaj(event, 'download-progress', { percent: progres.percent }))
    autoUpdater.on('update-downloaded', (info) => envoyerMaj(event, 'update-downloaded', info))
    autoUpdater.on('update-not-available', (info) => envoyerMaj(event, 'update-not-available', info))
    autoUpdater.on('checking-for-update', () => envoyerMaj(event, 'checking-for-update'))
    autoUpdater.on('error', (err) => envoyerMaj(event, 'realerror', err))
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch(arg){
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(event, data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            if(!majAutoPossible()){
                verifierMajManuelle(event)
                break
            }
            autoUpdater.checkForUpdates()
                .catch(err => envoyerMaj(event, 'realerror', err))
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'downloadUpdate':
            autoUpdater.downloadUpdate()
                .catch(err => envoyerMaj(event, 'realerror', err))
            break
        case 'installUpdateNow':
            // Senra : installation sans fenêtre d'installateur, puis le launcher se rouvre tout seul
            try {
                autoUpdater.quitAndInstall(true, true)
            } catch(err) {
                envoyerMaj(event, 'realerror', err)
            }
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

// Senra : accélération graphique activée. Helios la coupait, et tout était dessiné par le processeur
// (défilement et fondus saccadés, ~30 images/s). En cas de souci de pilote graphique : SENRA_SANS_GPU=1.
if(process.env.SENRA_SANS_GPU === '1'){
    app.disableHardwareAcceleration()
}


const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#070606',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SenraIcon')
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queryMap = {}
            
            new URL(uri).searchParams.forEach((v, k) => {
                queryMap[k] = v;
            });

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#070606',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SenraIcon')
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {

    win = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 1024,
        minHeight: 640,
        icon: getPlatformIcon('SenraIcon'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#070606'
    })
    remoteMain.enable(win.webContents)

    const data = {
        bkid: 0,
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    win.resizable = true

    // en jeu, fermer le launcher le range dans la zone de notification (le jeu et le statut Discord continuent)
    win.on('close', (e) => {
        if(plateau != null && !quitter){
            e.preventDefault()
            win.hide()
        }
    })

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

// Senra : pendant que le joueur est en jeu, le launcher se range dans la zone de notification (en bas à droite) ;
// un clic sur l'icône le rouvre, il revient tout seul quand le jeu se ferme, et sa croix le range au lieu de le fermer.
let plateau = null
let quitter = false

function montrerLauncher() {
    if(win != null && !win.isDestroyed()){
        if(win.isMinimized()){
            win.restore()
        }
        win.show()
        win.focus()
    }
}

function iconePlateau() {
    const taille = process.platform === 'darwin' ? 18 : 32
    return nativeImage.createFromPath(path.join(__dirname, 'app', 'assets', 'images', 'SenraIcon.png')).resize({ width: taille, height: taille })
}

ipcMain.on('senraEnJeu', (event, enJeu) => {
    if(win == null || win.isDestroyed()){
        return
    }
    if(enJeu){
        if(plateau == null){
            plateau = new Tray(iconePlateau())
            plateau.setToolTip('Senra Launcher · en jeu')
            plateau.setContextMenu(Menu.buildFromTemplate([
                { label: 'Ouvrir le launcher', click: montrerLauncher },
                { type: 'separator' },
                { label: 'Quitter le launcher', click: () => { quitter = true; app.quit() } }
            ]))
            plateau.on('click', montrerLauncher)
        }
        win.hide()
    } else {
        if(plateau != null){
            plateau.destroy()
            plateau = null
        }
        montrerLauncher()
    }
})

// une mise à jour (launcher ou mods) arrive pendant que le launcher est rangé : il réapparaît, sans prendre
// le focus au jeu (sa fenêtre revient et clignote dans la barre des tâches)
ipcMain.on('senraMontrer', () => {
    if(win == null || win.isDestroyed()){
        return
    }
    if(!win.isVisible()){
        win.showInactive()
    }
    win.flashFrame(true)
})

app.on('before-quit', () => {
    quitter = true
})

app.on('ready', createWindow)
app.on('ready', createMenu)
app.on('ready', integrerAppImage)

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})
