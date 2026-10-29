/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $                              = require('jquery')
const {ipcRenderer, shell, webFrame} = require('electron')
const remote                         = require('@electron/remote')
const isDev                          = require('./assets/js/isdev')
const { LoggerUtil }                 = require('helios-core')
const Lang                           = require('./assets/js/langloader')

const loggerUICore             = LoggerUtil.getLogger('UICore')
const loggerAutoUpdater        = LoggerUtil.getLogger('AutoUpdater')

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%cThe console is dark and full of terrors.', 'color: white; -webkit-text-stroke: 4px #a02d2a; font-size: 60px; font-weight: bold')
    console.log('%cIf you\'ve been told to paste something here, you\'re being scammed.', 'font-size: 16px')
    console.log('%cUnless you know exactly what you\'re doing, close this window.', 'font-size: 16px')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener
// Senra : à l'ouverture, le launcher cherche une nouvelle version. S'il y en a une, le joueur doit l'accepter
// (téléchargement, installation sans fenêtre, le launcher se rouvre) ou le launcher se ferme.
// macOS : pas d'installation automatique sans signature Apple, « Mettre à jour » ouvre le .dmg à télécharger.
// Une version publiée pendant que le launcher est ouvert : entrée « Mise à jour » dans la barre latérale.
// Une version publiée pendant que le launcher est ouvert (vérifié toutes les 5 minutes) : page de mise à jour tout de suite,
// ou, si le jeu est ouvert, une fenêtre qui prévient et la page dès que le jeu se ferme (senramaj.js).
const ATTENTE_VERIFICATION = 15000
const SURVEILLANCE_LAUNCHER = 300000
let premiereVerification = false
let delaiVerification = null
let majEnCours = false
let majProposee = null
let majLauncherEnAttente = null
let majModsEnAttente = null
let versionSignalee = null
if(!isDev){
    ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
        switch(arg){
            case 'checking-for-update':
                loggerAutoUpdater.info('Checking for update..')
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkingForUpdateButton'), true)
                break
            case 'update-available':
                loggerAutoUpdater.info('New update available', info.version)
                if(process.platform === 'darwin'){
                    info.darwindownload = `https://github.com/SenraMC/senra-launcher/releases/download/v${info.version}/Senra-Launcher-setup-${info.version}${process.arch === 'arm64' ? '-arm64' : '-x64'}.dmg`
                }
                // Linux installé sans AppImage ni .deb : pas d'installation automatique, on ouvre la page de la version
                if(info.manuel){
                    info.darwindownload = info.lien
                }
                majProposee = info
                populateSettingsUpdateInformation(info)
                if(process.platform !== 'darwin' && !info.manuel){
                    settingsUpdateButtonStatus('Mettre à jour maintenant', false, accepterMaj)
                }
                if(premiereVerification){
                    premiereVerification = false
                    clearTimeout(delaiVerification)
                    proposerMaj(info)
                } else if(versionSignalee !== info.version && !majEnCours){
                    versionSignalee = info.version
                    showUpdateUI(info)
                    if(typeof jeuEnCours === 'function' && jeuEnCours()){
                        majLauncherEnAttente = info
                        popupMaj('Mise à jour du launcher', `Senra Launcher ${info.version} est disponible. `
                            + 'Elle s\'installera dès que tu fermeras ton jeu.')
                    } else {
                        proposerMaj(info)
                    }
                }
                break
            case 'download-progress':
                if(majEnCours){
                    const pourcent = Math.round(info.percent)
                    ecranMaj({ titre: 'Mise à jour du launcher', etat: `Téléchargement… ${pourcent} %`, pourcent })
                }
                break
            case 'update-downloaded':
                loggerAutoUpdater.info('Update ' + info.version + ' ready to be installed.')
                if(majEnCours){
                    ecranMaj({ titre: 'Mise à jour du launcher', etat: 'Installation… le launcher va se rouvrir.', pourcent: 100 })
                    setTimeout(() => ipcRenderer.send('autoUpdateAction', 'installUpdateNow'), 800)
                }
                break
            case 'update-not-available':
                loggerAutoUpdater.info('No new update found.')
                finVerification()
                settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'))
                break
            case 'ready':
                premiereVerification = true
                ecranMaj({ titre: 'Recherche de mise à jour…', etat: 'Un instant.' })
                // sans réponse (pas de réseau, GitHub injoignable), on ouvre le launcher normalement
                delaiVerification = setTimeout(finVerification, ATTENTE_VERIFICATION)
                updateCheckListener = setInterval(() => {
                    ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                }, SURVEILLANCE_LAUNCHER)
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                break
            case 'realerror':
                finVerification()
                if(majEnCours){
                    majEnCours = false
                    // l'installation automatique n'est pas toujours possible (ex. Linux quand le launcher a été déplacé
                    // ou décompressé par un outil d'installation) : on propose aussi de télécharger la version à la main
                    ecranMaj({
                        titre: 'Mise à jour impossible',
                        etat: 'La mise à jour n\'a pas pu s\'installer toute seule. Télécharge la nouvelle version et installe-la, '
                            + 'ou réessaie si ta connexion a coupé.',
                        boutons: [
                            { texte: 'Télécharger', principal: true, action: () => {
                                shell.openExternal('https://github.com/SenraMC/senra-launcher/releases/latest')
                                quitterLauncher()
                            } },
                            { texte: 'Réessayer', action: accepterMaj },
                            { texte: 'Quitter', action: quitterLauncher }
                        ]
                    })
                }
                if(info != null && info.code != null){
                    if(info.code === 'ERR_UPDATER_INVALID_RELEASE_FEED'){
                        loggerAutoUpdater.info('No suitable releases found.')
                    } else if(info.code === 'ERR_XML_MISSED_ELEMENT'){
                        loggerAutoUpdater.info('No releases found.')
                    } else {
                        loggerAutoUpdater.error('Error during update check..', info)
                        loggerAutoUpdater.debug('Error Code:', info.code)
                    }
                }
                break
            default:
                loggerAutoUpdater.info('Unknown argument', arg)
                break
        }
    })
}

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 * 
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

/**
 * Écran de mise à jour par-dessus tout le launcher (recherche, proposition, téléchargement).
 *
 * @param {Object} contenu titre, version, etat, pourcent (barre si défini), boutons [{ texte, principal, action }].
 */
function ecranMaj({ titre, version = null, etat = '', pourcent = null, boutons = [] }){
    let ecran = document.getElementById('senraMajAuto')
    if(ecran == null){
        ecran = document.createElement('div')
        ecran.id = 'senraMajAuto'
        ecran.setAttribute('role', 'alertdialog')
        ecran.setAttribute('aria-live', 'polite')
        ecran.innerHTML = '<div class="carte"><img src="assets/images/senra/logo.png" alt=""><h2 class="majTitre"></h2>'
            + '<p class="version"></p><div class="piste"><div class="rempli"></div></div><p class="etat"></p><div class="boutons"></div></div>'
        document.body.appendChild(ecran)
    }
    ecran.querySelector('.majTitre').textContent = titre
    if(version != null){
        ecran.querySelector('.version').textContent = version
    }
    ecran.querySelector('.etat').textContent = etat
    ecran.querySelector('.piste').hidden = pourcent == null
    ecran.querySelector('.rempli').style.width = `${pourcent || 0}%`
    const zone = ecran.querySelector('.boutons')
    zone.replaceChildren(...boutons.map(b => {
        const bouton = document.createElement('button')
        bouton.type = 'button'
        bouton.className = b.principal ? 'principal' : 'secondaire'
        bouton.textContent = b.texte
        bouton.onclick = b.action
        return bouton
    }))
    zone.hidden = boutons.length === 0
    zone.querySelector('.principal')?.focus()
}

/** Fin de la recherche faite à l'ouverture : sans mise à jour à proposer, on laisse le launcher s'ouvrir. */
function finVerification(){
    if(!premiereVerification){
        return
    }
    premiereVerification = false
    clearTimeout(delaiVerification)
    if(!majEnCours){
        document.getElementById('senraMajAuto')?.remove()
    }
}

/** Une nouvelle version est publiée : le joueur l'accepte, ou le launcher se ferme. */
function proposerMaj(info){
    ecranMaj({
        titre: 'Mise à jour disponible',
        version: `Senra Launcher ${info.version}`,
        etat: telechargementManuel(info)
            ? 'Cette mise à jour est nécessaire pour continuer. Télécharge-la, installe-la, puis relance le launcher.'
            : 'Cette mise à jour est nécessaire pour continuer. Elle s\'installe toute seule, puis le launcher se rouvre.',
        boutons: [{ texte: telechargementManuel(info) ? 'Télécharger' : 'Mettre à jour', principal: true, action: accepterMaj },
            { texte: 'Quitter', action: quitterLauncher }]
    })
}

/** macOS (pas d'installation sans signature Apple) et Linux installé sans AppImage ni .deb : on télécharge à la main. */
function telechargementManuel(info){
    return process.platform === 'darwin' || (info != null && info.manuel === true)
}

function accepterMaj(){
    if(majProposee == null){
        return
    }
    if(telechargementManuel(majProposee)){
        shell.openExternal(majProposee.darwindownload)
        quitterLauncher()
        return
    }
    majEnCours = true
    ecranMaj({ titre: 'Mise à jour du launcher', version: `Senra Launcher ${majProposee.version}`, etat: 'Téléchargement… 0 %', pourcent: 0 })
    ipcRenderer.send('autoUpdateAction', 'downloadUpdate')
}

function quitterLauncher(){
    remote.app.quit()
}

function showUpdateUI(info){
    //TODO Make this message a bit more informative `${info.version}`
    // Senra : une entrée « Mise à jour prête » apparaît dans la barre latérale.
    // Le clic est déjà relié dans uibinder.js (allerA('maj')).
    document.getElementById('senraNavMaj').hidden = false
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if(window.isMaximized()){
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

        // Remove focus from social media buttons once they're clicked.
        Array.from(document.getElementsByClassName('mediaURL')).map(val => {
            val.addEventListener('click', e => {
                document.activeElement.blur()
            })
        })

    } else if(document.readyState === 'complete'){

        //266.01
        //170.8
        //53.21
        // Bind progress bar length to length of bot wrapper
        //const targetWidth = document.getElementById("launch_content").getBoundingClientRect().width
        //const targetWidth2 = document.getElementById("server_selection").getBoundingClientRect().width
        //const targetWidth3 = document.getElementById("launch_button").getBoundingClientRect().width


    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    shell.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code. 
 */
document.addEventListener('keydown', function (e) {
    if((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey){
        let window = remote.getCurrentWindow()
        window.toggleDevTools()
    }
})