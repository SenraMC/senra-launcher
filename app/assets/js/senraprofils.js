/**
 * Profils de mods de Senra.
 *
 * Un profil garde :
 *  - mods   : les interrupteurs des mods facultatifs du pack (même forme que la configuration de mods d'Helios) ;
 *  - ajouts : les mods que le joueur a pris lui-même sur Modrinth.
 *
 * Le profil actif est recopié dans la configuration de mods d'Helios : le lancement (ProcessBuilder)
 * n'a donc rien à savoir des profils pour les mods du pack. Les ajouts Modrinth, eux, sont téléchargés
 * dans {commonDirectory}/modrinth et ajoutés à la liste --fabric.addMods.
 */
const crypto        = require('crypto')
const fs            = require('fs-extra')
const path          = require('path')
const ConfigManager = require('./configmanager')

const BASE = 'base'

function nouvelId(){
    return 'p' + crypto.randomBytes(4).toString('hex')
}

/** L'état des profils d'un serveur, créé au premier appel. */
exports.etat = function(serverId){
    let etat = ConfigManager.getProfils(serverId)
    if(etat == null || !Array.isArray(etat.liste) || etat.liste.length === 0){
        const cfg = ConfigManager.getModConfiguration(serverId)
        etat = { actif: BASE, liste: [{ id: BASE, nom: 'De base', mods: cfg ? JSON.parse(JSON.stringify(cfg.mods)) : null, ajouts: [] }] }
        ConfigManager.setProfils(serverId, etat)
    }
    if(!etat.liste.some(p => p.id === etat.actif)){
        etat.actif = etat.liste[0].id
    }
    return etat
}

exports.liste = function(serverId){
    return exports.etat(serverId).liste
}

exports.actif = function(serverId){
    const etat = exports.etat(serverId)
    return etat.liste.find(p => p.id === etat.actif)
}

/** Recopie les interrupteurs actuels (configuration Helios) dans le profil actif. */
exports.enregistrer = function(serverId){
    const cfg = ConfigManager.getModConfiguration(serverId)
    if(cfg != null){
        exports.actif(serverId).mods = JSON.parse(JSON.stringify(cfg.mods))
    }
    ConfigManager.save()
}

/** Applique les interrupteurs d'un profil à la configuration Helios (clés inconnues ignorées). */
function appliquer(serverId, profil, defauts){
    const cfg = ConfigManager.getModConfiguration(serverId)
    if(cfg == null){
        return
    }
    const source = profil.mods || defauts || {}
    for(const id of Object.keys(cfg.mods)){
        if(typeof cfg.mods[id] === 'boolean'){
            if(typeof source[id] === 'boolean'){
                cfg.mods[id] = source[id]
            } else if(defauts && typeof defauts[id] === 'boolean'){
                cfg.mods[id] = defauts[id]
            }
        }
    }
    ConfigManager.setModConfiguration(serverId, cfg)
}

/**
 * Change de profil actif.
 * @param {Object} defauts Interrupteurs par défaut du pack ({id: bool}), pour un profil jamais réglé.
 */
exports.choisir = function(serverId, id, defauts){
    exports.enregistrer(serverId)
    const etat = exports.etat(serverId)
    const profil = etat.liste.find(p => p.id === id)
    if(profil == null){
        return
    }
    etat.actif = id
    appliquer(serverId, profil, defauts)
    exports.enregistrer(serverId)
}

/** Crée un profil réglé sur les choix de base du pack, et le rend actif. */
exports.creer = function(serverId, nom, defauts){
    exports.enregistrer(serverId)
    const etat = exports.etat(serverId)
    const profil = { id: nouvelId(), nom, mods: defauts ? { ...defauts } : null, ajouts: [] }
    etat.liste.push(profil)
    etat.actif = profil.id
    appliquer(serverId, profil, defauts)
    exports.enregistrer(serverId)
    return profil
}

exports.renommer = function(serverId, id, nom){
    const profil = exports.etat(serverId).liste.find(p => p.id === id)
    if(profil != null && nom.trim()){
        profil.nom = nom.trim().slice(0, 24)
        ConfigManager.save()
    }
}

exports.supprimer = function(serverId, id, defauts){
    const etat = exports.etat(serverId)
    if(etat.liste.length <= 1){
        return
    }
    etat.liste = etat.liste.filter(p => p.id !== id)
    if(etat.actif === id){
        etat.actif = etat.liste[0].id
        appliquer(serverId, etat.liste[0], defauts)
    }
    exports.enregistrer(serverId)
}

/** Remet les interrupteurs du profil actif sur les choix de base (les ajouts Modrinth restent). */
exports.retablir = function(serverId, defauts){
    const profil = exports.actif(serverId)
    profil.mods = defauts ? { ...defauts } : null
    appliquer(serverId, profil, defauts)
    exports.enregistrer(serverId)
}

/* ---------- ajouts Modrinth ---------- */

exports.ajouter = function(serverId, ajout){
    const profil = exports.actif(serverId)
    if(!profil.ajouts.some(a => a.slug === ajout.slug)){
        profil.ajouts.push(ajout)
        ConfigManager.save()
    }
}

exports.retirer = function(serverId, slug){
    const profil = exports.actif(serverId)
    profil.ajouts = profil.ajouts.filter(a => a.slug !== slug)
    ConfigManager.save()
}

exports.dossierAjouts = function(){
    return path.join(ConfigManager.getCommonDirectory(), 'modrinth')
}

/**
 * Un ajout que Senra refuse (liste du serveur dans distribution.json : slugs et mots interdits).
 * @param {Object} senraServeur rawServer.senra
 * @returns {string | null} la raison, ou null
 */
exports.raisonInterdit = function(ajout, senraServeur){
    const interdits = senraServeur?.interdits || {}
    if(interdits[ajout.slug]){
        return interdits[ajout.slug]
    }
    const texte = `${ajout.nom || ''} ${ajout.desc || ''}`
    if((senraServeur?.motsInterdits || []).some(m => new RegExp(m, 'i').test(texte))){
        return 'Interdit sur Senra : nuit au RP'
    }
    return null
}

function fichiersActifs(serverId, senraServeur){
    const vus = new Set()
    const fichiers = []
    for(const a of exports.actif(serverId).ajouts.filter(x => exports.raisonInterdit(x, senraServeur) == null)){
        for(const f of a.fichiers || []){
            if(!vus.has(f.nom)){
                vus.add(f.nom)
                fichiers.push(f)
            }
        }
    }
    return fichiers
}

/** Chemins des jars Modrinth du profil actif (pour --fabric.addMods). */
exports.cheminsActifs = function(serverId, senraServeur){
    return fichiersActifs(serverId, senraServeur)
        .map(f => path.join(exports.dossierAjouts(), path.basename(f.nom)))
        .filter(p => fs.existsSync(p))
}

function sha1(chemin){
    return crypto.createHash('sha1').update(fs.readFileSync(chemin)).digest('hex')
}

/**
 * Télécharge les jars Modrinth manquants ou abîmés du profil actif.
 * @param {(pourcent: number) => void} progression
 */
exports.telecharger = async function(serverId, progression = () => {}, senraServeur = null){
    const dossier = exports.dossierAjouts()
    await fs.ensureDir(dossier)
    const aFaire = fichiersActifs(serverId, senraServeur).filter(f => {
        const p = path.join(dossier, path.basename(f.nom))
        return !fs.existsSync(p) || (f.sha1 && sha1(p) !== f.sha1)
    })
    const total = aFaire.reduce((t, f) => t + (f.taille || 0), 0) || 1
    let fait = 0
    for(const f of aFaire){
        const r = await fetch(f.url)
        if(!r.ok){
            throw new Error(`Téléchargement impossible : ${f.nom} (${r.status})`)
        }
        const donnees = Buffer.from(await r.arrayBuffer())
        if(f.sha1 && crypto.createHash('sha1').update(donnees).digest('hex') !== f.sha1){
            throw new Error(`Fichier abîmé : ${f.nom}`)
        }
        await fs.writeFile(path.join(dossier, path.basename(f.nom)), donnees)
        fait += f.taille || donnees.length
        progression(Math.min(100, Math.round(fait / total * 100)))
    }
    return aFaire.length
}
