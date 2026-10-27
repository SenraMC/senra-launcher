/**
 * senraverif.js : vérification des fichiers avant le lancement, à la place de la « réparation complète » d'Helios.
 *
 * - Seulement ce qui sert : Minecraft, Fabric, les mods obligatoires et cochés, et les bibliothèques
 *   dont un mod actif a besoin (les mods décochés ne sont ni vérifiés, ni téléchargés, ni chargés).
 * - Un fichier déjà vérifié dont la taille et la date n'ont pas bougé n'est pas relu en entier :
 *   mémoire dans commonDir/senra_verif.json.
 * - L'avancement est donné fichier par fichier.
 */
const fs = require('fs-extra')
const path = require('path')
const { MojangIndexProcessor, downloadQueue, getExpectedDownloadSize, HashAlgo } = require('helios-core/dl')
const { Type } = require('helios-distribution-types')
// le module réel (les processeurs d'helios-core lisent validateLocalFile dessus à chaque appel)
const FileUtils = require(path.join(path.dirname(require.resolve('helios-core')), 'common', 'util', 'FileUtils.js'))
const ConfigManager = require('./configmanager')

const validerSansMemoire = FileUtils.validateLocalFile

function slugDe(module){
    return module.rawModule.id.split(':')[1]
}

function estActif(config, module){
    const cfg = config != null ? config[module.getVersionlessMavenIdentifier()] : null
    if(module.getRequired().value){
        return true
    }
    if(cfg == null){
        return module.getRequired().def
    }
    return typeof cfg === 'boolean' ? cfg : (cfg.value !== undefined ? cfg.value : true)
}

/**
 * Les mods à charger : obligatoires et cochés, puis les bibliothèques dont un mod retenu a besoin.
 *
 * @param {Array} modules Les mods (FabricMod) retenus par la configuration d'Helios.
 */
exports.filtrerBibliotheques = function(modules){
    const bibliotheques = modules.filter(m => m.rawModule.senra?.categorie === 'bibliotheque')
    const retenus = new Set(modules.filter(m => m.rawModule.senra?.categorie !== 'bibliotheque').map(slugDe))
    let ajout = true
    while(ajout){
        ajout = false
        for(const b of bibliotheques){
            if(!retenus.has(slugDe(b)) && (b.rawModule.senra.pour || []).some(s => retenus.has(s))){
                retenus.add(slugDe(b))
                ajout = true
            }
        }
    }
    return modules.filter(m => m.rawModule.senra?.categorie !== 'bibliotheque' || retenus.has(slugDe(m)))
}

/** Les mods (FabricMod) actifs selon la configuration du joueur, sous-modules compris. */
function modsActifs(config, modules){
    let actifs = []
    for(const m of modules){
        if(m.rawModule.type === Type.FabricMod && estActif(config, m)){
            actifs.push(m)
            if(m.subModules.length > 0){
                const sousCfg = config?.[m.getVersionlessMavenIdentifier()]?.mods
                actifs = actifs.concat(modsActifs(sousCfg, m.subModules))
            }
        }
    }
    return actifs
}

/** Le nombre de mods actifs du profil, sans les bibliothèques (celui affiché sur l'accueil). */
exports.nombreModsActifs = function(serveur){
    const config = ConfigManager.getModConfiguration(serveur.rawServer.id)?.mods
    return modsActifs(config, serveur.modules).filter(m => m.rawModule.senra?.categorie !== 'bibliotheque').length
}

/** Tous les fichiers de la distribution à vérifier pour ce serveur. */
function fichiersDistribution(serveur){
    const config = ConfigManager.getModConfiguration(serveur.rawServer.id)?.mods
    const liste = []
    const ajouter = m => {
        liste.push(m)
        m.subModules.forEach(ajouter)
    }
    // Fabric et ses bibliothèques (et tout ce qui n'est pas un mod) : toujours
    serveur.modules.filter(m => m.rawModule.type !== Type.FabricMod).forEach(ajouter)
    exports.filtrerBibliotheques(modsActifs(config, serveur.modules)).forEach(m => liste.push(m))
    return liste
}

/**
 * Vérifie les fichiers et télécharge ceux qui manquent ou sont abîmés.
 *
 * @param {Object} serveur Le serveur de la distribution (HeliosServer).
 * @param {(etape: 'verification'|'telechargement', pourcent: number) => void} progression
 * @returns {Promise<number>} Le nombre de fichiers téléchargés.
 */
exports.verifier = async function(serveur, progression){
    const commun = ConfigManager.getCommonDirectory()
    const fichierMemoire = path.join(commun, 'senra_verif.json')
    let memoire = {}
    try {
        memoire = await fs.readJson(fichierMemoire)
    } catch {
        memoire = {}
    }
    const nouvelle = {}

    const mojang = new MojangIndexProcessor(commun, serveur.rawServer.minecraftVersion)
    await mojang.init()
    const distribution = fichiersDistribution(serveur)
    const dossierObjets = path.join(mojang.assetPath, 'objects')
    const objets = Object.values(mojang.assetIndex.objects).map(o => ({ chemin: path.join(dossierObjets, o.hash.substring(0, 2), o.hash), hash: o.hash }))
    const total = objets.length + mojang.versionJson.libraries.length + 2 + distribution.length
    let faits = 0
    let dernier = -1
    const avancer = () => {
        faits++
        const pourcent = Math.min(100, Math.floor(faits / total * 100))
        if(pourcent !== dernier){
            dernier = pourcent
            progression('verification', pourcent)
        }
    }

    // même résultat que validateLocalFile, sans relire un fichier inchangé depuis la dernière vérification
    // (les sons et textures sont comptés à part, pendant la passe en parallèle)
    const validerAvecMemoire = async (chemin, algo, hash) => {
        if(!chemin.startsWith(dossierObjets)){
            avancer()
        }
        let infos
        try {
            infos = await fs.stat(chemin)
        } catch {
            return false
        }
        if(hash == null){
            return true
        }
        const connu = nouvelle[chemin] || memoire[chemin]
        if(connu && connu[0] === infos.size && connu[1] === infos.mtimeMs && connu[2] === hash){
            nouvelle[chemin] = connu
            return true
        }
        const valide = await validerSansMemoire(chemin, algo, hash)
        if(valide){
            nouvelle[chemin] = [infos.size, infos.mtimeMs, hash]
        }
        return valide
    }

    // les ~4 000 sons et textures : vérifiés 16 à la fois (Helios les relisait un par un) ;
    // la vérification d'Helios qui suit ne fait plus que retrouver le résultat dans la mémoire
    let suivant = 0
    await Promise.all(Array.from({ length: 16 }, async () => {
        while(suivant < objets.length){
            const objet = objets[suivant++]
            await validerAvecMemoire(objet.chemin, HashAlgo.SHA1, objet.hash)
            avancer()
        }
    }))

    FileUtils.validateLocalFile = validerAvecMemoire
    const aTelecharger = []
    try {
        const resultat = await mojang.validate(async () => {})
        Object.values(resultat).flat().forEach(f => aTelecharger.push(f))
        for(const m of distribution){
            const artefact = m.rawModule.artifact
            if(!await validerAvecMemoire(m.getPath(), HashAlgo.MD5, artefact.MD5)){
                aTelecharger.push({ id: m.rawModule.id, hash: artefact.MD5, algo: HashAlgo.MD5, size: artefact.size, url: artefact.url, path: m.getPath() })
            }
        }
    } finally {
        FileUtils.validateLocalFile = validerSansMemoire
    }
    await fs.outputJson(fichierMemoire, nouvelle)
    progression('verification', 100)

    if(aTelecharger.length > 0){
        const attendu = getExpectedDownloadSize(aTelecharger)
        let pourcent = -1
        progression('telechargement', 0)
        await downloadQueue(aTelecharger, recu => {
            const p = Math.min(100, Math.floor(recu / attendu * 100))
            if(p !== pourcent){
                pourcent = p
                progression('telechargement', p)
            }
        })
        progression('telechargement', 100)
    }
    return aTelecharger.length
}
