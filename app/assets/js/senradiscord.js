// Senra : le statut Discord du joueur (Rich Presence) tant que le Senra Launcher est ouvert.
// « Joue à Senra RP » (le nom de l'application Discord), ce qu'il fait (launcher, menus, sur Senra RP…), depuis quand,
// et deux boutons : le Discord et le site. Les réglages viennent de distribution.json → "discord" :
//   { "clientId": "…", "image": "senra", "texteImage": "Senra Naruto RP", "boutons": [{ "label": "…", "url": "…" }] }
// donc on peut les changer sans nouvelle version du launcher. Sans clientId, rien n'est envoyé à Discord.
// SenraHUD dit où joue le joueur par une ligne « [SenraHUD] PRESENCE <état> » dans le journal du jeu (landing.js la lit).
const { LoggerUtil } = require('helios-core')
const { Client }     = require('discord-rpc-patch')

const logger = LoggerUtil.getLogger('SenraDiscord')

// ce que voient ses amis sous « Joue à Senra RP » ; depuis = le chrono repart quand il entre sur un serveur
const ETATS = {
    launcher:  { details: 'Dans le launcher',          state: 'Prépare sa partie' },
    lancement: { details: 'Lance Senra RP',            state: 'Chargement du jeu…' },
    menus:     { details: 'Dans les menus',            state: 'Minecraft 1.21.11' },
    senra:     { details: 'Joue à Senra Naruto RP',    state: 'En ligne sur le serveur', depuis: true },
    build:     { details: 'Construit sur Senra Build', state: 'Serveur de construction', depuis: true },
    serveur:   { details: 'En jeu',                    state: 'Sur un autre serveur',    depuis: true },
    solo:      { details: 'En jeu',                    state: 'Monde solo',              depuis: true }
}
const RELANCE = 30000  // Discord fermé ou redémarré : on réessaie toutes les 30 s

let reglages = null
let client = null
let connecte = false
let relance = null
let etat = 'launcher'
const ouverture = Date.now()
let depuis = ouverture

function activite(){
    const e = ETATS[etat] || ETATS.launcher
    const a = {
        details: e.details,
        state: e.state,
        startTimestamp: e.depuis ? depuis : ouverture,
        largeImageKey: reglages.image || 'senra',
        largeImageText: reglages.texteImage || 'Senra Naruto RP',
        instance: false
    }
    if(reglages.petiteImage){
        a.smallImageKey = reglages.petiteImage
        a.smallImageText = reglages.textePetiteImage || 'Senra Launcher'
    }
    // Discord accepte 2 boutons au plus (libellé de 32 caractères maximum)
    const boutons = (reglages.boutons || []).filter(b => b && b.label && b.url).slice(0, 2)
        .map(b => ({ label: String(b.label).slice(0, 32), url: String(b.url) }))
    if(boutons.length > 0){
        a.buttons = boutons
    }
    return a
}

function publier(){
    if(client == null || !connecte || reglages == null){
        return
    }
    client.setActivity(activite()).catch(err => logger.warn('Statut Discord refusé : ' + err.message))
}

function planifier(){
    clearTimeout(relance)
    relance = setTimeout(connecter, RELANCE)
}

function connecter(){
    if(reglages == null || !reglages.clientId || client != null){
        return
    }
    const c = new Client({ transport: 'ipc' })
    client = c
    c.on('ready', () => {
        connecte = true
        logger.info('Statut Discord actif.')
        publier()
    })
    c.on('disconnected', () => {
        if(client === c){
            client = null
            connecte = false
            planifier()
        }
    })
    c.login({ clientId: reglages.clientId }).catch(err => {
        // Discord pas lancé (ENOENT / connexion refusée) : pas grave, on réessaie plus tard
        if(client === c){
            client = null
            connecte = false
        }
        logger.info('Discord injoignable pour le statut (' + err.message + '), nouvel essai dans 30 s.')
        planifier()
    })
}

/** Réglages lus dans la distribution (à chaque chargement / rafraîchissement). */
exports.configurer = function(nouveaux){
    nouveaux = nouveaux && nouveaux.clientId ? nouveaux : null
    if(JSON.stringify(nouveaux) === JSON.stringify(reglages)){
        return
    }
    const autreAppli = reglages == null || nouveaux == null || reglages.clientId !== nouveaux.clientId
    reglages = nouveaux
    if(autreAppli && client != null){
        const ancien = client
        client = null
        connecte = false
        ancien.destroy().catch(() => {})
    }
    if(reglages == null){
        clearTimeout(relance)
        return
    }
    if(client != null){
        publier()
    } else {
        connecter()
    }
}

/** launcher, lancement, menus, senra, build, serveur ou solo. */
exports.etat = function(nom){
    if(!ETATS[nom] || nom === etat){
        return
    }
    etat = nom
    if(ETATS[nom].depuis){
        depuis = Date.now()
    }
    publier()
}

/** Lignes du journal du jeu : « [SenraHUD] PRESENCE senra » etc. */
const PRESENCE_REGEX = /\[SenraHUD\] PRESENCE (\w+)/
exports.lireJournal = function(ligne){
    const m = PRESENCE_REGEX.exec(ligne)
    if(m){
        exports.etat(m[1])
    }
}
