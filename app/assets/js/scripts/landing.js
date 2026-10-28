/**
 * Script for landing.ejs — accueil de Senra : la couverture, l'état du lancement,
 * les joueurs connectés, le profil de mods et le bouton Jouer.
 */
// Requirements
const {
    getServerStatus
}                             = require('helios-core/mojang')
// isDisplayableError et RestResponseStatus servent aussi à settings.js et login.js (erreurs de connexion).
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const SenraDiscord            = require('./assets/js/senradiscord')
const ProcessBuilder          = require('./assets/js/processbuilder')
const SenraVerif              = require('./assets/js/senraverif')

// Launch Elements
const senraLancement          = document.getElementById('senraLancement')
const launch_progress         = document.getElementById('launch_progress')
const launch_details_text     = document.getElementById('launch_details_text')
const senraSousTitre          = document.getElementById('senraSousTitre')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

let lancementEnCours = false
let jeuOuvert = false

// Senra : l'image de l'accueil et le fond de la fenêtre changent ensemble toutes les 6 s, en fondu
// (orange d'abord, puis bleu, violet, vert, neige). La nouvelle image passe par-dessus, l'ancienne s'efface ensuite.
const DUREE_FOND = 6000
const NOMBRE_FONDS = 5
let fondActuel = 0
function montrerFond(n){
    for(const groupe of [document.querySelectorAll('#senraFonds .fond'), document.querySelectorAll('.couverture img')]){
        const nouveau = Array.from(groupe).find(e => Number(e.dataset.fond) === n)
        groupe.forEach(e => e.classList.toggle('dessus', e === nouveau))
        nouveau.classList.add('visible')
        setTimeout(() => groupe.forEach(e => {
            if(e !== nouveau){
                e.classList.remove('visible')
            }
        }), 1700)
    }
}
setInterval(() => {
    if(!document.hidden){
        fondActuel = (fondActuel + 1) % NOMBRE_FONDS
        montrerFond(fondActuel)
    }
}, DUREE_FOND)

/* Launch Progress Wrapper Functions */

/**
 * Montre ou cache l'état de lancement (barre de progression, bouton Jouer désactivé).
 *
 * @param {boolean} loading True pendant la préparation du jeu.
 */
function toggleLaunchArea(loading){
    lancementEnCours = loading
    if(loading){
        senraLancement.setAttribute('data-progres', '')
    } else {
        senraLancement.removeAttribute('data-progres')
        launch_progress.style.width = '0'
        launch_details_text.textContent = Lang.queryJS('senra.pretAJouer') || 'Prêt à jouer'
        majResumeAccueil()
    }
    document.getElementById('launch_button').disabled = loading || jeuOuvert || ConfigManager.getSelectedServer() == null
    document.getElementById('senraChoixProfil').disabled = loading || jeuOuvert
}

/**
 * Tant que Minecraft tourne : bouton « En jeu » désactivé (pas de deuxième jeu ni de changement de profil).
 *
 * @param {boolean} enJeu True quand la fenêtre du jeu est ouverte.
 */
function etatEnJeu(enJeu){
    jeuOuvert = enJeu
    document.getElementById('senraTexteJouer').textContent = enJeu ? 'En jeu' : 'Jouer'
    toggleLaunchArea(false)
    if(enJeu){
        launch_details_text.textContent = 'Minecraft est ouvert'
        senraSousTitre.textContent = 'Ferme le jeu pour relancer ou changer de profil.'
    }
}

/**
 * Texte de l'étape en cours (le titre du bandeau).
 *
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.textContent = String(details).replace(/\.\.$/, '…')
}

/**
 * Pourcentage de l'étape en cours.
 *
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    launch_progress.style.width = `${percent}%`
    launch_progress.parentElement.setAttribute('aria-valuenow', String(percent))
    senraSousTitre.textContent = `${percent} %`
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 *
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 *
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val || lancementEnCours || jeuOuvert
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Le compte, en haut à droite : ouvre l'onglet Compte.
document.getElementById('senraCompte').onclick = () => allerA('compte')

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    const tete = document.getElementById('senraTeteCompte')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if(authUser.uuid != null){
            tete.src = `https://mc-heads.net/avatar/${authUser.uuid}/60`
        }
    } else {
        tete.removeAttribute('src')
    }
    user_text.textContent = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
async function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    if(serv != null){
        const fabric = serv.modules.find(m => m.rawModule.type === 'Fabric')
        const versionFabric = fabric ? fabric.mavenComponents.version : '—'
        document.getElementById('senraNomServeur').textContent = serv.rawServer.name
        document.getElementById('senraMetaServeur').textContent = `Minecraft ${serv.rawServer.minecraftVersion} · Fabric ${versionFabric}`
    }
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
    majResumeAccueil()
}

/* ---------- résumé et profil (bandeau de l'accueil) ---------- */

/**
 * Les modules mods du serveur choisi, et les interrupteurs par défaut du pack.
 */
async function modsDuServeur(){
    const distro = await DistroAPI.getDistribution()
    const serv = distro.getServerById(ConfigManager.getSelectedServer())
    if(serv == null){
        return null
    }
    const mods = serv.modules.filter(m => m.rawModule.type === 'FabricMod')
    const defauts = {}
    for(const m of mods){
        if(!m.getRequired().value){
            defauts[m.getVersionlessMavenIdentifier()] = m.getRequired().def
        }
    }
    return { serv, mods, defauts }
}

/** Nombre de mods chargés par un profil (hors bibliothèques), ajouts Modrinth compris. */
function compterMods(mods, profil){
    const parSlug = Object.fromEntries(mods.map(m => [m.mavenComponents.artifact, m]))
    const coche = m => m.getRequired().value || !!(profil.mods || {})[m.getVersionlessMavenIdentifier()]
    const effectif = m => coche(m) && (!m.rawModule.senra?.parent || (parSlug[m.rawModule.senra.parent] && effectif(parSlug[m.rawModule.senra.parent])))
    return mods.filter(m => m.rawModule.senra?.categorie !== 'bibliotheque' && effectif(m)).length + profil.ajouts.length
}

async function majResumeAccueil(){
    const d = await modsDuServeur().catch(() => null)
    if(d == null){
        return
    }
    const id = d.serv.rawServer.id
    SenraProfils.enregistrer(id)
    const profil = SenraProfils.actif(id)
    document.getElementById('senraNomProfil').textContent = profil.nom
    if(!lancementEnCours && !jeuOuvert){
        senraSousTitre.innerHTML = `Pack ${d.serv.rawServer.version} · <b>${compterMods(d.mods, profil)} mods</b> dans ce profil`
    }
    rendreMenuProfils(d)
}

function rendreMenuProfils(d){
    const id = d.serv.rawServer.id
    const actif = SenraProfils.actif(id)
    const menu = document.getElementById('senraMenuProfils')
    menu.innerHTML = SenraProfils.liste(id).map(p => `<button type="button" role="menuitemradio" aria-checked="${p.id === actif.id}" data-profil="${p.id}">
            <span>${escHTML(p.nom)} <small>${compterMods(d.mods, p)} mods</small></span>${p.id === actif.id ? '<svg><use href="#i-coche"/></svg>' : ''}</button>`).join('')
        + '<hr><button type="button" role="menuitem" data-gerer>Gérer les profils<svg><use href="#i-chevron"/></svg></button>'
}

function escHTML(s){
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function ouvrirMenuProfils(ouvert){
    document.getElementById('senraMenuProfils').hidden = !ouvert
    document.getElementById('senraChoixProfil').setAttribute('aria-expanded', String(ouvert))
}
document.getElementById('senraChoixProfil').addEventListener('click', e => {
    e.stopPropagation()
    ouvrirMenuProfils(document.getElementById('senraMenuProfils').hidden)
})
document.getElementById('senraMenuProfils').addEventListener('click', async e => {
    e.stopPropagation()
    ouvrirMenuProfils(false)
    if(e.target.closest('[data-gerer]')){
        allerA('mods')
        return
    }
    const b = e.target.closest('[data-profil]')
    if(b){
        const d = await modsDuServeur()
        SenraProfils.choisir(d.serv.rawServer.id, b.dataset.profil, d.defauts)
        majResumeAccueil()
    }
})
document.addEventListener('click', () => ouvrirMenuProfils(false))
document.addEventListener('keydown', e => { if(e.key === 'Escape') ouvrirMenuProfils(false) })

/* ---------- statut du serveur : nombre de joueurs et heure d'actualisation ---------- */

const refreshServerStatus = async (_fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    const point = document.getElementById('senraPointServeur')
    const texte = document.getElementById('senraTexteServeur')
    try {
        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        document.getElementById('player_count').textContent = String(servStat.players.online)
        document.getElementById('senraPlaces').textContent = `/ ${servStat.players.max}`
        document.getElementById('landingPlayerLabel').textContent = `connectés · actualisé à ${heure}`
        point.classList.remove('ferme')
        texte.textContent = 'En ligne'
    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
        document.getElementById('player_count').textContent = '—'
        document.getElementById('senraPlaces').textContent = ''
        document.getElementById('landingPlayerLabel').textContent = `serveur injoignable · essai à ${heure}`
        point.classList.add('ferme')
        texte.textContent = 'Fermé'
    }
}

// Server Status is refreshed in uibinder.js on distributionIndexDone.
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 *
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 *
 * @param {boolean} launchAfter Whether we should begin to launch after scanning.
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)

            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            loggerLanding.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
// Senra : étapes du démarrage de Minecraft lues dans son journal, jusqu'à la fenêtre du jeu (signal de SenraHUD)
let nombreModsLances = 0
const ETAPES_DEMARRAGE = [
    { re: /Loading Minecraft .+ with Fabric Loader/, pct: 10, texte: () => 'Chargement de Fabric…' },
    // Fabric compte aussi les morceaux internes (les modules de Fabric API…) : on affiche le nombre de mods du profil
    { re: /Loading (\d+) mods/, pct: 22, texte: () => `Chargement de tes ${nombreModsLances} mods…` },
    { re: /Setting user: /, pct: 62, texte: () => 'Préparation de Minecraft…' },
    { re: /Backend library: LWJGL/, pct: 85, texte: () => 'Ouverture de la fenêtre…' }
]
const FENETRE_PRETE_REGEX = /\[SenraHUD\] FENETRE_PRETE/
// sans le signal (SenraHUD absent ou en panne), on considère le jeu ouvert au bout de 3 minutes
const ATTENTE_FENETRE_MAX = 180000

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    // Senra : vérification et téléchargement des seuls fichiers utiles (mods cochés), avec la mémoire des fichiers
    // déjà vérifiés (senraverif.js) au lieu de la réparation complète d'Helios qui relisait tout à chaque lancement.
    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let etapeVerif = 'verification'
    try {
        const debut = Date.now()
        const telecharges = await SenraVerif.verifier(serv, (etape, pourcent) => {
            if(etape !== etapeVerif){
                etapeVerif = etape
                setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
            }
            if(etape === 'telechargement'){
                setDownloadPercentage(pourcent)
            } else {
                setLaunchPercentage(pourcent)
            }
        })
        loggerLaunchSuite.info(`Fichiers vérifiés en ${Date.now() - debut} ms, ${telecharges} téléchargé(s).`)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.', err)
        const titre = etapeVerif === 'telechargement' ? 'landing.dlAsync.errorDuringFileDownloadTitle' : 'landing.dlAsync.errorDuringFileVerificationTitle'
        showLaunchFailure(Lang.queryJS(titre), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Senra : les mods Modrinth du profil actif.
    try {
        SenraProfils.enregistrer(serv.rawServer.id)
        if(SenraProfils.actif(serv.rawServer.id).ajouts.length > 0){
            setLaunchDetails('Mods ajoutés depuis Modrinth')
            setLaunchPercentage(0)
        }
        const n = await SenraProfils.telecharger(serv.rawServer.id, pct => setDownloadPercentage(pct), serv.rawServer.senra)
        setLaunchPercentage(100)
        loggerLaunchSuite.info(`${n} mod(s) Modrinth téléchargé(s).`)
        remote.getCurrentWindow().setProgressBar(-1)
    } catch(err) {
        loggerLaunchSuite.error('Error during Modrinth download.', err)
        showLaunchFailure('Téléchargement interrompu', `${err.message}. Vérifie ta connexion, ou retire ce mod de ton profil.`)
        return
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        nombreModsLances = SenraVerif.nombreModsActifs(serv) + SenraProfils.actif(serv.rawServer.id).ajouts.length
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))
        SenraDiscord.etat('lancement')

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        let jeuFerme = false
        const onLoadComplete = () => {
            if(jeuFerme || proc == null){
                return
            }
            remote.getCurrentWindow().setProgressBar(-1)
            etatEnJeu(true)
            SenraDiscord.etat('menus')
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }

        // Senra : la barre avance avec les étapes du démarrage (et doucement entre deux étapes),
        // jusqu'à ce que SenraHUD signale que la fenêtre du jeu est affichée.
        let progression = 0
        let etape = -1
        let fenetreOuverte = false
        let reste = ''
        const plafond = () => (etape + 1 < ETAPES_DEMARRAGE.length ? ETAPES_DEMARRAGE[etape + 1].pct : 98) - 2
        const avance = setInterval(() => {
            progression += (plafond() - progression) * 0.03
            setDownloadPercentage(Math.round(progression))
        }, 100)
        const quandFenetreOuverte = () => {
            if(fenetreOuverte){
                return
            }
            fenetreOuverte = true
            clearInterval(avance)
            clearTimeout(secours)
            setLaunchDetails('Minecraft est ouvert')
            setDownloadPercentage(100)
            setTimeout(onLoadComplete, 1200)
        }
        const secours = setTimeout(quandFenetreOuverte, ATTENTE_FENETRE_MAX)

        const tempListener = function(data){
            const lignes = (reste + data.toString()).split(/\r?\n/)
            reste = lignes.pop()
            for(const ligne of lignes){
                if(FENETRE_PRETE_REGEX.test(ligne)){
                    quandFenetreOuverte()
                    return
                }
                for(let i = etape + 1; i < ETAPES_DEMARRAGE.length; i++){
                    const m = ETAPES_DEMARRAGE[i].re.exec(ligne)
                    if(m){
                        etape = i
                        progression = Math.max(progression, ETAPES_DEMARRAGE[i].pct)
                        setLaunchDetails(ETAPES_DEMARRAGE[i].texte(m))
                        setDownloadPercentage(Math.round(progression))
                        break
                    }
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()

            // Bind listeners to stdout.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)
            // Senra : statut Discord, d'après les lignes « [SenraHUD] PRESENCE … » du journal (Senra RP, Build, menus…)
            let resteJournal = ''
            proc.stdout.on('data', data => {
                const lignes = (resteJournal + data.toString()).split(/\r?\n/)
                resteJournal = lignes.pop()
                lignes.forEach(SenraDiscord.lireJournal)
            })

            setLaunchDetails('Démarrage de Java…')
            setDownloadPercentage(0)

            // jeu fermé (ou planté au démarrage) : le bouton Jouer revient
            proc.on('close', () => {
                jeuFerme = true
                clearInterval(avance)
                clearTimeout(secours)
                remote.getCurrentWindow().setProgressBar(-1)
                etatEnJeu(false)
                SenraDiscord.etat('launcher')
                proc = null
            })

        } catch(err) {

            clearInterval(avance)
            clearTimeout(secours)
            SenraDiscord.etat('launcher')
            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}
