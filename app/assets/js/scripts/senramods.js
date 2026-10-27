/**
 * Onglet Mods de Senra : profils, mods du pack par catégorie, ajouts Modrinth.
 * Chargé après settings.js : les fonctions de l'onglet Mods d'Helios sont remplacées ici.
 */

const SENRA_CATEGORIES = [
    { id: 'obligatoires', nom: 'Obligatoires', desc: 'Le serveur en a besoin : ils sont toujours chargés.' },
    { id: 'performance', nom: 'Performance', desc: 'Plus d’images par seconde et moins de mémoire. Cochés de base : ne les retire qu’en cas de souci.' },
    { id: 'confort', nom: 'Confort', desc: 'Immersion sonore et joueurs plus vivants. Coche ce que ton PC peut porter.' },
    { id: 'deconseille', nom: 'Déconseillé', desc: 'Peut nuire à l’expérience de jeu s’il est mal utilisé.' }
]
const SENRA_MEMOIRE_DE_BASE = 4
const SENRA_API = 'https://api.modrinth.com/v2'
const SENRA_FACETTES = JSON.stringify([['categories:fabric'], ['versions:1.21.11'], ['project_type:mod'], ['categories!=library']])

let senra = null                 // données du pack pour le serveur choisi
let senraConfirmerIris = false
let senraRenommage = false
let senraSuppression = false
let senraResultats = null
let senraNumeroRecherche = 0
const senraEtatsAjout = {}

/* ---------- chiffres ---------- */
const senraF1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const senraEntier = new Intl.NumberFormat('fr-FR')
const senraDixiemes = o => Math.round(o / 1e5)
const senraMo = d => `${d === 0 ? '&lt; 0,1' : senraF1.format(d / 10)}<span class="unite">Mo</span>`
const senraMillions = n => n >= 1e6 ? `${senraF1.format(n / 1e6)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n)
const senraEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Lit le pack du serveur choisi dans la distribution. */
async function senraCharger(){
    const distro = await DistroAPI.getDistribution()
    const serv = distro.getServerById(ConfigManager.getSelectedServer())
    const modules = serv.modules.filter(m => m.rawModule.type === Type.FabricMod)
    const tous = modules.map(m => {
        const s = m.rawModule.senra || {}
        return {
            id: m.getVersionlessMavenIdentifier(),
            slug: m.mavenComponents.artifact,
            nom: m.rawModule.name,
            cat: s.categorie || (m.getRequired().value ? 'obligatoires' : 'confort'),
            desc: s.desc || '',
            parent: s.parent || null,
            poids: s.poids || null,
            memoire: s.memoire || 0,
            libs: s.libs || [],
            icone: s.icone || (s.maison ? './assets/images/senra/logo.png' : null),
            verrou: m.getRequired().value,
            defaut: m.getRequired().def,
            octets: m.rawModule.artifact.size
        }
    })
    const parSlug = Object.fromEntries(tous.map(m => [m.slug, m]))
    const defauts = {}
    for(const m of tous){
        if(!m.verrou){
            defauts[m.id] = m.defaut
        }
    }
    senra = {
        serv,
        servId: serv.rawServer.id,
        tous,
        mods: tous.filter(m => m.cat !== 'bibliotheque'),
        parSlug,
        defauts,
        dansLePack: new Set(tous.map(m => m.slug)),
        interdits: serv.rawServer.senra?.interdits || {}
    }
    return senra
}

const senraConf = () => ConfigManager.getModConfiguration(senra.servId).mods
const senraCoche = m => m.verrou || senraConf()[m.id] === true
const senraEffectif = m => senraCoche(m) && (!m.parent || (senra.parSlug[m.parent] != null && senraEffectif(senra.parSlug[m.parent])))
const senraActifs = () => senra.mods.filter(senraEffectif)
const senraPoids = m => senraDixiemes(m.octets + m.libs.reduce((t, s) => t + (senra.parSlug[s]?.octets || 0), 0))
const senraSomme = liste => liste.reduce((t, m) => t + senraPoids(m), 0)
const senraSommeAjouts = p => p.ajouts.reduce((t, a) => t + senraDixiemes(a.octets || 0), 0)
const senraMemoireConseillee = () => SENRA_MEMOIRE_DE_BASE + senraActifs().reduce((t, m) => t + (m.memoire || 0), 0)

function senraMemoireAllouee(){
    const v = String(ConfigManager.getMaxRAM(senra.servId))
    const n = Number.parseFloat(v)
    return v.toUpperCase().endsWith('M') ? Math.round(n / 1024 * 10) / 10 : n
}

/* ---------- rendu ---------- */
function senraRendre(){
    const profil = SenraProfils.actif(senra.servId)
    const liste = senraActifs()
    const n = liste.length + profil.ajouts.length
    const rec = senraMemoireConseillee()
    const ram = senraMemoireAllouee()
    const iris = senra.parSlug.iris ? senraEffectif(senra.parSlug.iris) : false
    const libs = new Set(liste.flatMap(m => m.libs)).size

    const constat = document.getElementById('senraConstatMods')
    constat.classList.toggle('alerte', iris)
    constat.textContent = iris
        ? `Iris est activé dans « ${profil.nom} » : il peut entrer en conflit avec certains plugins du serveur.`
        : `${n} mods se chargeront avec le profil « ${profil.nom} ». Iris reste désactivé, il est déconseillé sur Senra.`

    // profils
    document.getElementById('senraOnglets').innerHTML = SenraProfils.liste(senra.servId).map(p => (p.id === profil.id && senraRenommage
        ? `<input class="onglet-saisie" id="senraSaisieProfil" value="${senraEsc(p.nom)}" maxlength="24" aria-label="Nom du profil">`
        : `<button class="onglet" role="tab" type="button" aria-selected="${p.id === profil.id}" data-onglet="${p.id}">${senraEsc(p.nom)}<small class="num">${compterMods(senra.serv.modules.filter(m => m.rawModule.type === Type.FabricMod), p)}</small></button>`)).join('')
    document.getElementById('senraActionsProfil').innerHTML = senraSuppression
        ? `<span class="question">Supprimer « ${senraEsc(profil.nom)} » ?</span><button class="action negatif" type="button" data-act="oui">Supprimer</button><button class="action" type="button" data-act="non">Annuler</button>`
        : `<button class="action" type="button" data-act="renommer">Renommer</button><button class="action" type="button" data-act="retablir">Rétablir les choix de base</button>${SenraProfils.liste(senra.servId).length > 1 ? '<button class="action negatif" type="button" data-act="supprimer">Supprimer</button>' : ''}`
    const saisie = document.getElementById('senraSaisieProfil')
    if(saisie){
        saisie.focus()
        saisie.select()
    }

    document.getElementById('senraResume').innerHTML = `
        <div><dt>Mods chargés</dt><dd class="num">${n}<span class="unite">sur ${senra.mods.length + profil.ajouts.length}</span><small>et ${libs} bibliothèques qui les accompagnent</small></dd></div>
        <div><dt>Poids des mods</dt><dd class="num">${senraMo(senraSomme(liste) + senraSommeAjouts(profil))}<small>chargés avec ce profil</small></dd></div>
        <div><dt>Mémoire conseillée</dt><dd class="num${rec > ram ? ' attention' : ''}">${rec}<span class="unite">Go</span><small>${rec > ram ? `tu alloues ${senraF1.format(ram)} Go · <button class="lien" type="button" data-java>Régler</button>` : `tu alloues ${senraF1.format(ram)} Go, c’est assez`}</small></dd></div>`

    document.getElementById('senraSections').innerHTML = SENRA_CATEGORIES.map(c => {
        const mods = senra.mods.filter(m => m.cat === c.id)
        if(mods.length === 0){
            return ''
        }
        const coches = mods.filter(senraEffectif)
        const resume = c.id === 'obligatoires'
            ? `${mods.length} mods · ${senraF1.format(senraSomme(mods) / 10)} Mo`
            : `${coches.length} sur ${mods.length} ${coches.length > 1 ? 'cochés' : 'coché'} · ${senraF1.format(senraSomme(coches) / 10)} Mo`
        return `<section class="section" aria-labelledby="senraCat-${c.id}">
            <div class="etiquette"><h2 id="senraCat-${c.id}">${c.nom}</h2><p>${c.desc}</p><p class="compte-cat num">${resume}</p></div>
            <div class="liste">${c.id === 'deconseille' ? senraAvisIris() : ''}${mods.map(m => senraLigne(m, rec, ram)).join('')}</div>
        </section>`
    }).join('')

    // ajouts Modrinth
    const nA = profil.ajouts.length
    document.getElementById('senraResumeAjouts').textContent = nA ? `${nA} ${nA > 1 ? 'mods ajoutés' : 'mod ajouté'} · ${senraF1.format(senraSommeAjouts(profil) / 10)} Mo` : 'Aucun ajout dans ce profil'
    document.getElementById('senraAjouts').innerHTML = nA ? profil.ajouts.map(a => `<div class="mod ajout">
            ${a.icone ? `<img class="icone" src="${senraEsc(a.icone)}" alt="">` : `<span class="icone sans-icone" aria-hidden="true">${senraEsc(a.nom[0])}</span>`}
            <div><div class="nom"><span>${senraEsc(a.nom)}</span>${SenraProfils.raisonInterdit(a, senra.serv.rawServer.senra) ? '<span class="pastille interdit">Interdit sur Senra : ne sera pas chargé</span>' : ''}</div>
                <p class="desc une-ligne">${senraEsc(a.desc)}${a.deps && a.deps.length ? ` <span class="avec">Avec ${a.deps.map(senraEsc).join(', ')}.</span>` : ''}</p></div>
            <span class="taille num">${senraMo(senraDixiemes(a.octets || 0))}</span>
            <button class="bouton petit" type="button" data-retirer="${senraEsc(a.slug)}" aria-label="Retirer ${senraEsc(a.nom)}">Retirer</button>
        </div>`).join('') : `<p class="vide">Aucun mod ajouté à « ${senraEsc(profil.nom)} ». Cherche-en un ci-dessous.</p>`
    senraRendreResultats()
    senraMajConseilMemoire(rec, profil)
    // shaders : seulement avec Iris coché
    senraRendreShaders()
    if(iris && senraShaders == null){
        senraChercherShaders('')
    }
}

function senraAvisIris(){
    if(senraConfirmerIris){
        return `<div class="avis" role="alert"><svg><use href="#i-alerte"/></svg><div><p>Iris peut entrer en conflit avec certains plugins du serveur. L’activer quand même ?</p>
            <div class="actions"><button class="bouton" type="button" data-iris="oui">Activer Iris</button><button class="bouton" type="button" data-iris="non">Garder désactivé</button></div></div></div>`
    }
    return '<div class="avis"><svg><use href="#i-alerte"/></svg><p>Déconseillé : Iris peut entrer en conflit avec certains plugins du serveur.</p></div>'
}

function senraLigne(m, rec, ram){
    const parent = m.parent && senra.parSlug[m.parent]
    const bloque = parent && !senraEffectif(parent)
    const enfant = parent && parent.cat === m.cat
    const poids = senraPoids(m)
    const icone = m.icone ? `<img class="icone" src="${senraEsc(m.icone)}" alt="">` : `<span class="icone sans-icone" aria-hidden="true">${senraEsc(m.nom[0])}</span>`
    const avec = m.libs.length ? ` <span class="avec">Avec ${m.libs.map(s => senraEsc(senra.parSlug[s]?.nom || s)).join(', ')}.</span>` : ''
    const demande = bloque ? ` <span class="avec">Demande ${senraEsc(parent.nom)}.</span>` : ''
    const commande = m.verrou
        ? '<svg class="verrou" role="img" aria-label="Toujours chargé"><title>Toujours chargé</title><use href="#i-verrou"/></svg>'
        : `<input class="interrupteur" type="checkbox" data-mod="${senraEsc(m.id)}" aria-label="Charger ${senraEsc(m.nom)}"${senraCoche(m) && !bloque ? ' checked' : ''}${bloque ? ' disabled' : ''}>`
    let html = `<div class="mod${enfant ? ' enfant' : ''}${bloque ? ' coupe' : ''}">
        ${icone}
        <div><div class="nom"><span>${senraEsc(m.nom)}</span>${m.poids === 'lourd' ? '<span class="pastille lourd">Lourd</span>' : ''}</div>
            <p class="desc">${senraEsc(m.desc)}${avec}${demande}</p></div>
        <span class="taille num">${senraMo(poids)}</span>
        <span class="commande">${commande}</span>
    </div>`
    if(m.slug === 'distanthorizons' && senraEffectif(m) && rec > ram){
        html += `<div class="avis"><svg><use href="#i-alerte"/></svg><p>Avec Distant Horizons, tes mods demandent ${rec} Go de mémoire : tu en alloues ${senraF1.format(ram)}. <button class="lien" type="button" data-java>Régler la mémoire</button></p></div>`
    }
    return html
}

function senraMajConseilMemoire(rec, profil){
    const el = document.getElementById('senraMemoireConseil')
    if(el){
        el.textContent = `Le profil « ${profil.nom} » demande au moins ${rec} Go.`
    }
}

/* ---------- interrupteurs ---------- */
function senraSauver(){
    const cfg = ConfigManager.getModConfiguration(senra.servId)
    ConfigManager.setModConfiguration(senra.servId, cfg)
    SenraProfils.enregistrer(senra.servId)
}

document.getElementById('senraSections').addEventListener('change', e => {
    const id = e.target.dataset.mod
    if(!id){
        return
    }
    const m = senra.tous.find(x => x.id === id)
    if(m.slug === 'iris' && e.target.checked){
        e.target.checked = false
        senraConfirmerIris = true
        senraRendre()
        return
    }
    const conf = senraConf()
    conf[id] = e.target.checked
    if(!e.target.checked){
        // un mod qui en demande un autre ne peut pas rester seul (plantage au lancement)
        for(const d of senra.tous.filter(x => x.parent === m.slug)){
            conf[d.id] = false
        }
    }
    senraSauver()
    senraRendre()
})

document.getElementById('settingsTabMods').addEventListener('click', e => {
    const choix = e.target.dataset.iris
    if(choix){
        senraConfirmerIris = false
        if(choix === 'oui'){
            senraConf()[senra.parSlug.iris.id] = true
            senraSauver()
        }
        senraRendre()
        return
    }
    if(e.target.closest('[data-java]')){
        allerA('java')
        return
    }
    const onglet = e.target.closest('[data-onglet]')
    if(onglet){
        SenraProfils.choisir(senra.servId, onglet.dataset.onglet, senra.defauts)
        senraRenommage = false
        senraSuppression = false
        senraConfirmerIris = false
        senraRendre()
        majResumeAccueil()
        return
    }
    const act = e.target.closest('[data-act]')?.dataset.act
    if(act){
        const profil = SenraProfils.actif(senra.servId)
        if(act === 'renommer') senraRenommage = true
        if(act === 'retablir') SenraProfils.retablir(senra.servId, senra.defauts)
        if(act === 'supprimer') senraSuppression = true
        if(act === 'non') senraSuppression = false
        if(act === 'oui'){
            SenraProfils.supprimer(senra.servId, profil.id, senra.defauts)
            senraSuppression = false
        }
        senraRendre()
        majResumeAccueil()
        return
    }
    const aj = e.target.closest('[data-ajouter]')
    if(aj){
        senraAjouter(aj.dataset.ajouter)
        return
    }
    const re = e.target.closest('[data-retirer]')
    if(re){
        SenraProfils.retirer(senra.servId, re.dataset.retirer)
        senraRendre()
        majResumeAccueil()
        return
    }
    if(e.target.id === 'senraReessayer'){
        senraChercher(document.getElementById('senraCherche').value.trim())
    }
})

document.getElementById('senraOnglets').addEventListener('dblclick', e => {
    if(e.target.closest('[data-onglet]')){
        senraRenommage = true
        senraRendre()
    }
})
function senraFinirRenommage(garder){
    const s = document.getElementById('senraSaisieProfil')
    if(!senraRenommage || !s){
        return
    }
    if(garder){
        SenraProfils.renommer(senra.servId, SenraProfils.actif(senra.servId).id, s.value)
    }
    senraRenommage = false
    senraRendre()
    majResumeAccueil()
}
document.getElementById('senraOnglets').addEventListener('keydown', e => {
    if(e.target.id !== 'senraSaisieProfil') return
    if(e.key === 'Enter') senraFinirRenommage(true)
    if(e.key === 'Escape') senraFinirRenommage(false)
})
document.getElementById('senraOnglets').addEventListener('focusout', e => {
    if(e.target.id === 'senraSaisieProfil') senraFinirRenommage(true)
})
document.getElementById('senraNouveauProfil').addEventListener('click', () => {
    const noms = SenraProfils.liste(senra.servId).map(p => p.nom)
    let i = noms.length + 1
    while(noms.includes(`Profil ${i}`)) i++
    SenraProfils.creer(senra.servId, `Profil ${i}`, senra.defauts)
    senraRenommage = true
    senraSuppression = false
    senraRendre()
    majResumeAccueil()
})
document.getElementById('senraAllerModrinth').addEventListener('click', () => {
    document.getElementById('senraSecModrinth').scrollIntoView({ behavior: 'smooth' })
    document.getElementById('senraCherche').focus({ preventScroll: true })
})

/* ---------- Modrinth : mods Fabric 1.21.11 seulement ---------- */
async function senraChercher(q){
    const n = ++senraNumeroRecherche
    const etat = document.getElementById('senraEtatRecherche')
    etat.textContent = q ? 'Recherche sur Modrinth…' : 'Chargement des mods les plus téléchargés…'
    try {
        const url = `${SENRA_API}/search?` + new URLSearchParams({ query: q, facets: SENRA_FACETTES, index: q ? 'relevance' : 'downloads', limit: q ? '8' : '24' })
        const r = await fetch(url)
        if(!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        if(n !== senraNumeroRecherche) return
        let hits = j.hits.map(h => ({ slug: h.slug, nom: h.title, auteur: h.author, desc: h.description, icone: h.icon_url, telechargements: h.downloads }))
        if(!q) hits = hits.filter(h => !senra.dansLePack.has(h.slug)).slice(0, 6)
        senraResultats = hits
        etat.textContent = !q ? 'Les plus téléchargés pour Fabric 1.21.11, hors pack Senra'
            : j.total_hits ? `${senraEntier.format(j.total_hits)} ${j.total_hits > 1 ? 'mods trouvés' : 'mod trouvé'}${j.total_hits > hits.length ? ` · les ${hits.length} plus proches` : ''}`
                : `Aucun mod Fabric 1.21.11 ne correspond à « ${q} ».`
    } catch {
        if(n !== senraNumeroRecherche) return
        senraResultats = []
        etat.innerHTML = 'Modrinth ne répond pas. <button class="lien" type="button" id="senraReessayer">Réessayer</button>'
    }
    senraRendreResultats()
}

function senraStatut(h){
    const raison = SenraProfils.raisonInterdit(h, senra.serv.rawServer.senra)
    if(raison) return `<span class="pastille interdit">${senraEsc(raison)}</span>`
    if(senra.dansLePack.has(h.slug)) return '<span class="statut-ajout">Dans le pack</span>'
    if(SenraProfils.actif(senra.servId).ajouts.some(a => a.slug === h.slug)) return '<button class="bouton petit" type="button" disabled><svg><use href="#i-coche"/></svg>Ajouté</button>'
    const e = senraEtatsAjout[h.slug]
    if(e === 'ajout') return '<button class="bouton petit" type="button" disabled>Ajout…</button>'
    if(e) return `<span class="statut-ajout">${senraEsc(e)}</span>`
    return `<button class="bouton petit" type="button" data-ajouter="${senraEsc(h.slug)}" aria-label="Ajouter ${senraEsc(h.nom)}"><svg><use href="#i-plus"/></svg>Ajouter</button>`
}

function senraRendreResultats(){
    if(senraResultats == null) return
    document.getElementById('senraResultats').innerHTML = senraResultats.map(h => `<div class="mod resultat">
            ${h.icone ? `<img class="icone" src="${senraEsc(h.icone)}" alt="" loading="lazy">` : `<span class="icone sans-icone" aria-hidden="true">${senraEsc(h.nom[0])}</span>`}
            <div><div class="nom"><span>${senraEsc(h.nom)}</span></div>
                <p class="desc une-ligne">par ${senraEsc(h.auteur)} · ${senraMillions(h.telechargements)} téléchargements · ${senraEsc(h.desc)}</p></div>
            <span class="commande">${senraStatut(h)}</span>
        </div>`).join('')
}

/** La version Fabric 1.21.11 la plus récente d'un projet Modrinth, et son fichier principal. */
async function senraVersion(idOuSlug){
    const q = new URLSearchParams({ game_versions: '["1.21.11"]', loaders: '["fabric"]' })
    const r = await fetch(`${SENRA_API}/project/${encodeURIComponent(idOuSlug)}/version?${q}`)
    if(!r.ok) throw new Error(String(r.status))
    const vs = await r.json()
    if(!vs.length) return null
    const v = vs[0]
    const f = v.files.find(x => x.primary) || v.files[0]
    return { v, fichier: { nom: f.filename, url: f.url, sha1: f.hashes.sha1, taille: f.size } }
}

async function senraAjouter(slug){
    const h = senraResultats.find(x => x.slug === slug)
    senraEtatsAjout[slug] = 'ajout'
    senraRendreResultats()
    try {
        const principal = await senraVersion(slug)
        if(principal == null){
            senraEtatsAjout[slug] = 'Pas de version 1.21.11'
            senraRendreResultats()
            return
        }
        // dépendances requises qui ne sont pas déjà dans le pack (deux niveaux)
        const fichiers = [principal.fichier]
        const deps = []
        let aVoir = principal.v.dependencies.filter(d => d.dependency_type === 'required' && d.project_id).map(d => d.project_id)
        const vus = new Set()
        for(let niveau = 0; niveau < 2 && aVoir.length; niveau++){
            const projets = await fetch(`${SENRA_API}/projects?ids=${encodeURIComponent(JSON.stringify(aVoir))}`).then(x => x.json())
            aVoir = []
            for(const p of projets){
                if(vus.has(p.id) || senra.dansLePack.has(p.slug)) continue
                vus.add(p.id)
                const d = await senraVersion(p.id)
                if(d == null) continue
                deps.push(p.title)
                fichiers.push(d.fichier)
                aVoir.push(...d.v.dependencies.filter(x => x.dependency_type === 'required' && x.project_id).map(x => x.project_id))
            }
        }
        SenraProfils.ajouter(senra.servId, {
            slug, nom: h.nom, desc: h.desc, icone: h.icone, version: principal.v.version_number,
            octets: fichiers.reduce((t, f) => t + f.taille, 0), fichiers, deps
        })
        delete senraEtatsAjout[slug]
        senraRendre()
        majResumeAccueil()
    } catch {
        senraEtatsAjout[slug] = 'Modrinth ne répond pas'
        senraRendreResultats()
    }
}

let senraAttente = null
document.getElementById('senraCherche').addEventListener('input', e => {
    clearTimeout(senraAttente)
    senraAttente = setTimeout(() => senraChercher(e.target.value.trim()), 300)
})

/* ---------- shaders (Iris coché) : ceux installés et la recherche Modrinth ---------- */
const senraFs = require('fs-extra')
const senraChemin = require('path')
const senraHachage = require('crypto')
const SENRA_FACETTES_SHADERS = JSON.stringify([['project_type:shader'], ['categories:iris']])
let senraShaders = null
let senraNumeroShaders = 0
const senraEtatsShader = {}

const senraDossierShaders = () => senraChemin.join(ConfigManager.getInstanceDirectory(), senra.servId, 'shaderpacks')
const senraFichierIris = () => senraChemin.join(ConfigManager.getInstanceDirectory(), senra.servId, 'config', 'iris.properties')
// nom, image et projet Modrinth des shaders installés par le launcher
const senraFichierInfos = () => senraChemin.join(senraDossierShaders(), '.senra-shaders.json')

function senraLireJson(fichier){
    try {
        return senraFs.readJsonSync(fichier)
    } catch {
        return {}
    }
}

/** Les réglages d'Iris (config/iris.properties) : enableShaders et shaderPack. */
function senraLireIris(){
    const valeurs = {}
    try {
        for(const ligne of senraFs.readFileSync(senraFichierIris(), 'utf8').split(/\r?\n/)){
            const i = ligne.indexOf('=')
            if(i > 0 && !ligne.startsWith('#')){
                valeurs[ligne.slice(0, i)] = ligne.slice(i + 1)
            }
        }
    } catch {
        // pas encore de fichier : Iris le créera au premier lancement
    }
    return valeurs
}

function senraEcrireIris(changements){
    let lignes = []
    try {
        lignes = senraFs.readFileSync(senraFichierIris(), 'utf8').split(/\r?\n/).filter(l => l !== '')
    } catch {
        lignes = []
    }
    const restants = { ...changements }
    lignes = lignes.map(l => {
        const i = l.indexOf('=')
        const cle = i > 0 && !l.startsWith('#') ? l.slice(0, i) : null
        if(cle != null && cle in restants){
            const ligne = `${cle}=${restants[cle]}`
            delete restants[cle]
            return ligne
        }
        return l
    })
    for(const [cle, valeur] of Object.entries(restants)){
        lignes.push(`${cle}=${valeur}`)
    }
    senraFs.outputFileSync(senraFichierIris(), lignes.join('\n') + '\n')
}

function senraShadersInstalles(){
    try {
        return senraFs.readdirSync(senraDossierShaders(), { withFileTypes: true })
            .filter(e => e.isDirectory() || e.name.toLowerCase().endsWith('.zip'))
            .map(e => ({ fichier: e.name, octets: e.isFile() ? senraFs.statSync(senraChemin.join(senraDossierShaders(), e.name)).size : 0 }))
    } catch {
        return []
    }
}

function senraRendreShaders(){
    const iris = senra.parSlug.iris ? senraEffectif(senra.parSlug.iris) : false
    document.getElementById('senraSecShaders').hidden = !iris
    if(!iris){
        return
    }
    const installes = senraShadersInstalles()
    const infos = senraLireJson(senraFichierInfos())
    const reglages = senraLireIris()
    const actif = reglages.enableShaders === 'true' ? reglages.shaderPack : ''
    const nomDe = f => infos[f]?.nom || f.replace(/\.zip$/i, '')
    const n = installes.length
    document.getElementById('senraResumeShaders').textContent = n
        ? `${n} ${n > 1 ? 'shaders installés' : 'shader installé'} · ${actif ? `utilisé : ${nomDe(actif)}` : 'aucun utilisé'}`
        : 'Aucun shader installé'
    document.getElementById('senraShadersInstalles').innerHTML = n ? installes.map(s => {
        const info = infos[s.fichier] || {}
        const utilise = s.fichier === actif
        return `<div class="mod ajout">
            ${info.icone ? `<img class="icone" src="${senraEsc(info.icone)}" alt="">` : `<span class="icone sans-icone" aria-hidden="true">${senraEsc(nomDe(s.fichier)[0])}</span>`}
            <div><div class="nom"><span>${senraEsc(nomDe(s.fichier))}</span>${utilise ? '<span class="statut-ajout">Utilisé</span>' : ''}</div>
                <p class="desc une-ligne">${senraEsc(info.desc || s.fichier)}</p></div>
            <span class="taille num">${s.octets ? senraMo(senraDixiemes(s.octets)) : ''}</span>
            <span class="commande">${utilise
                ? '<button class="bouton petit" type="button" data-shader-couper>Désactiver</button>'
                : `<button class="bouton petit" type="button" data-shader-utiliser="${senraEsc(s.fichier)}">Utiliser</button>`}
                <button class="bouton petit" type="button" data-shader-retirer="${senraEsc(s.fichier)}" aria-label="Retirer ${senraEsc(nomDe(s.fichier))}">Retirer</button></span>
        </div>`
    }).join('') : '<p class="vide">Aucun shader installé. Cherche-en un ci-dessous.</p>'
    senraRendreResultatsShaders()
}

function senraStatutShader(h){
    const raison = SenraProfils.raisonInterdit(h, senra.serv.rawServer.senra)
    if(raison) return `<span class="pastille interdit">${senraEsc(raison)}</span>`
    const infos = senraLireJson(senraFichierInfos())
    if(Object.values(infos).some(i => i.slug === h.slug)) return '<button class="bouton petit" type="button" disabled><svg><use href="#i-coche"/></svg>Installé</button>'
    const e = senraEtatsShader[h.slug]
    if(e === 'installation') return '<button class="bouton petit" type="button" disabled>Installation…</button>'
    if(e) return `<span class="statut-ajout">${senraEsc(e)}</span>`
    return `<button class="bouton petit" type="button" data-shader-installer="${senraEsc(h.slug)}" aria-label="Installer ${senraEsc(h.nom)}"><svg><use href="#i-plus"/></svg>Installer</button>`
}

function senraRendreResultatsShaders(){
    if(senraShaders == null) return
    document.getElementById('senraResultatsShaders').innerHTML = senraShaders.map(h => `<div class="mod resultat">
            ${h.icone ? `<img class="icone" src="${senraEsc(h.icone)}" alt="" loading="lazy">` : `<span class="icone sans-icone" aria-hidden="true">${senraEsc(h.nom[0])}</span>`}
            <div><div class="nom"><span>${senraEsc(h.nom)}</span></div>
                <p class="desc une-ligne">par ${senraEsc(h.auteur)} · ${senraMillions(h.telechargements)} téléchargements · ${senraEsc(h.desc)}</p></div>
            <span class="commande">${senraStatutShader(h)}</span>
        </div>`).join('')
}

async function senraChercherShaders(q){
    const n = ++senraNumeroShaders
    const etat = document.getElementById('senraEtatShaders')
    etat.textContent = q ? 'Recherche sur Modrinth…' : 'Chargement des shaders les plus téléchargés…'
    try {
        const url = `${SENRA_API}/search?` + new URLSearchParams({ query: q, facets: SENRA_FACETTES_SHADERS, index: q ? 'relevance' : 'downloads', limit: q ? '8' : '6' })
        const r = await fetch(url)
        if(!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        if(n !== senraNumeroShaders) return
        senraShaders = j.hits.map(h => ({ slug: h.slug, nom: h.title, auteur: h.author, desc: h.description, icone: h.icon_url, telechargements: h.downloads }))
        etat.textContent = !q ? 'Les plus téléchargés pour Iris'
            : j.total_hits ? `${senraEntier.format(j.total_hits)} ${j.total_hits > 1 ? 'shaders trouvés' : 'shader trouvé'}${j.total_hits > senraShaders.length ? ` · les ${senraShaders.length} plus proches` : ''}`
                : `Aucun shader pour Iris ne correspond à « ${q} ».`
    } catch {
        if(n !== senraNumeroShaders) return
        senraShaders = []
        etat.innerHTML = 'Modrinth ne répond pas. <button class="lien" type="button" id="senraReessayerShaders">Réessayer</button>'
    }
    senraRendreResultatsShaders()
}

/** Télécharge la dernière version pour Iris (celle qui annonce la 1.21.11 si elle existe) et l'utilise tout de suite. */
async function senraInstallerShader(slug){
    const h = senraShaders.find(x => x.slug === slug)
    senraEtatsShader[slug] = 'installation'
    senraRendreResultatsShaders()
    try {
        const versions = async jeu => {
            const q = new URLSearchParams({ loaders: '["iris"]' })
            if(jeu) q.set('game_versions', '["1.21.11"]')
            const r = await fetch(`${SENRA_API}/project/${encodeURIComponent(slug)}/version?${q}`)
            if(!r.ok) throw new Error(String(r.status))
            return r.json()
        }
        let vs = await versions(true)
        if(!vs.length) vs = await versions(false)
        if(!vs.length){
            senraEtatsShader[slug] = 'Pas de version pour Iris'
            senraRendreResultatsShaders()
            return
        }
        const f = vs[0].files.find(x => x.primary) || vs[0].files[0]
        const donnees = Buffer.from(await (await fetch(f.url)).arrayBuffer())
        if(senraHachage.createHash('sha1').update(donnees).digest('hex') !== f.hashes.sha1) throw new Error('fichier abîmé')
        const nom = senraChemin.basename(f.filename)
        await senraFs.outputFile(senraChemin.join(senraDossierShaders(), nom), donnees)
        const infos = senraLireJson(senraFichierInfos())
        infos[nom] = { slug, nom: h.nom, desc: h.desc, icone: h.icone, version: vs[0].version_number }
        await senraFs.outputJson(senraFichierInfos(), infos)
        senraEcrireIris({ enableShaders: 'true', shaderPack: nom })
        delete senraEtatsShader[slug]
    } catch {
        senraEtatsShader[slug] = 'Modrinth ne répond pas'
    }
    senraRendreShaders()
}

document.getElementById('senraSecShaders').addEventListener('click', e => {
    const utiliser = e.target.closest('[data-shader-utiliser]')
    if(utiliser){
        senraEcrireIris({ enableShaders: 'true', shaderPack: utiliser.dataset.shaderUtiliser })
        senraRendreShaders()
        return
    }
    if(e.target.closest('[data-shader-couper]')){
        senraEcrireIris({ enableShaders: 'false' })
        senraRendreShaders()
        return
    }
    const retirer = e.target.closest('[data-shader-retirer]')
    if(retirer){
        const fichier = retirer.dataset.shaderRetirer
        senraFs.removeSync(senraChemin.join(senraDossierShaders(), fichier))
        const infos = senraLireJson(senraFichierInfos())
        delete infos[fichier]
        senraFs.outputJsonSync(senraFichierInfos(), infos)
        if(senraLireIris().shaderPack === fichier){
            senraEcrireIris({ enableShaders: 'false', shaderPack: '' })
        }
        senraRendreShaders()
        return
    }
    const installer = e.target.closest('[data-shader-installer]')
    if(installer){
        senraInstallerShader(installer.dataset.shaderInstaller)
        return
    }
    if(e.target.id === 'senraReessayerShaders'){
        senraChercherShaders(document.getElementById('senraChercheShader').value.trim())
    }
})

let senraAttenteShaders = null
document.getElementById('senraChercheShader').addEventListener('input', e => {
    clearTimeout(senraAttenteShaders)
    senraAttenteShaders = setTimeout(() => senraChercherShaders(e.target.value.trim()), 300)
})

/* ---------- remplacements des fonctions de l'onglet Mods d'Helios ---------- */
async function prepareModsTab(){
    await senraCharger()
    senraRenommage = false
    senraSuppression = false
    senraRendre()
    if(senraResultats == null){
        senraChercher('')
    }
}
function saveModConfiguration(){
    if(senra != null){
        senraSauver()
    }
}
function saveAllModConfigurations(){
    saveModConfiguration()
    ConfigManager.save()
}
function saveDropinModConfiguration(){}
function saveShaderpackSettings(){}
async function reloadDropinMods(){}
async function resolveShaderpacksForUI(){}
