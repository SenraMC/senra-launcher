/**
 * Senra : pendant que le launcher est ouvert, il guette les mises à jour.
 *
 * Mods (obligatoires ou non) : la liste publiée sur GitHub est relue toutes les minutes (version fraîche, sans cache).
 * Si elle a changé, le launcher la recharge puis :
 *  - jeu fermé : grande page « Mise à jour disponible » et les nouveaux fichiers se téléchargent tout de suite ;
 *  - jeu ouvert : fenêtre « redémarre ton jeu » (et notification Windows) ; la page s'affiche quand le jeu se ferme.
 * Launcher : voir uicore.js (même logique : page tout de suite, ou dès que le jeu est fermé).
 */
const SURVEILLANCE_MODS = Number(process.env.SENRA_SURVEILLANCE_MS) || 60000
let pageMajEnCours = false

/** Les mods d'une distribution : clé (groupe:nom) -> nom affiché, version, MD5. */
function modulesDe(raw){
    const sortie = new Map()
    const parcourir = modules => {
        for(const m of modules || []){
            const morceaux = String(m.id || '').split('@')[0].split(':')
            const cle = morceaux.slice(0, 2).join(':')
            if(cle){
                sortie.set(cle, {
                    nom: m.name || morceaux[1],
                    version: (m.senra && m.senra.version) || morceaux[2] || '',
                    md5: (m.artifact && m.artifact.MD5) || ''
                })
            }
            parcourir(m.subModules)
        }
    }
    for(const serveur of (raw && raw.servers) || []){
        parcourir(serveur.modules)
    }
    return sortie
}

/** Ce qui change entre deux distributions, en phrases courtes (« SenraHUD 1.0.6 → 1.1.0 »). */
function changementsMods(ancienne, nouvelle){
    const avant = modulesDe(ancienne), apres = modulesDe(nouvelle), liste = []
    for(const [cle, m] of apres){
        const a = avant.get(cle)
        if(a == null){
            liste.push(`Nouveau : ${m.nom}`)
        } else if(a.md5 !== m.md5){
            liste.push(a.version && m.version && a.version !== m.version ? `${m.nom} ${a.version} → ${m.version}` : `${m.nom} mis à jour`)
        }
    }
    for(const [cle, a] of avant){
        if(!apres.has(cle)){
            liste.push(`Retiré : ${a.nom}`)
        }
    }
    return liste
}

function jeuEnCours(){
    return jeuOuvert || lancementEnCours
}

/** Petite fenêtre par-dessus le launcher (le jeu est ouvert), avec une notification Windows en plus. */
function popupMaj(titre, texte){
    let popup = document.getElementById('senraPopupMaj')
    if(popup == null){
        popup = document.createElement('div')
        popup.id = 'senraPopupMaj'
        popup.setAttribute('role', 'alertdialog')
        popup.setAttribute('aria-live', 'assertive')
        popup.innerHTML = '<div class="carte"><img src="assets/images/senra/logo.png" alt=""><h2></h2><p class="texte"></p>'
            + '<div class="boutons"><button type="button" class="principal">Compris</button></div></div>'
        popup.querySelector('button').onclick = () => popup.remove()
        document.body.appendChild(popup)
    }
    popup.querySelector('h2').textContent = titre
    popup.querySelector('.texte').textContent = texte
    popup.querySelector('button').focus()
    try {
        remote.getCurrentWindow().flashFrame(true)
        new Notification(titre, { body: texte, icon: 'assets/images/SenraIcon.png', silent: false })
    } catch(err) {
        // pas de notification possible : la fenêtre du launcher suffit
    }
}

/** La grande page de mise à jour des mods : les nouveaux fichiers sont téléchargés tout de suite. */
async function pageMajMods(liste){
    if(pageMajEnCours){
        return
    }
    pageMajEnCours = true
    majModsEnAttente = null
    document.getElementById('senraPopupMaj')?.remove()
    const titre = 'Mise à jour disponible'
    const version = liste.slice(0, 3).join(' · ') + (liste.length > 3 ? ` · et ${liste.length - 3} autre(s)` : '')
    ecranMaj({ titre, version, etat: 'Préparation…', pourcent: 0 })
    try {
        remote.getCurrentWindow().flashFrame(true)
        const distro = await DistroAPI.getDistribution()
        const serv = distro.getServerById(ConfigManager.getSelectedServer())
        await SenraVerif.verifier(serv, (etape, pourcent) => {
            const p = Math.round(pourcent)
            ecranMaj({ titre, version, etat: etape === 'telechargement' ? `Téléchargement… ${p} %` : `Vérification des fichiers… ${p} %`, pourcent: p })
        })
        ecranMaj({ titre: 'Mise à jour terminée', version, etat: 'Tout est prêt, tu peux jouer.', pourcent: 100,
            boutons: [{ texte: 'Continuer', principal: true, action: fermerPageMaj }] })
    } catch(err) {
        loggerLanding.warn('Mise à jour des mods impossible pour l\'instant.', err)
        ecranMaj({ titre: 'Mise à jour disponible', version, etat: 'Le téléchargement n\'a pas pu se faire : il se refera quand tu cliqueras sur Jouer.',
            boutons: [{ texte: 'Continuer', principal: true, action: fermerPageMaj }] })
    }
    pageMajEnCours = false
    majResumeAccueil()
}

function fermerPageMaj(){
    document.getElementById('senraMajAuto')?.remove()
}

/** Relit la liste des mods publiée ; si elle a changé, la recharge et prévient le joueur. */
async function verifierMods(){
    if(lancementEnCours || pageMajEnCours || document.getElementById('senraMajAuto') != null || DistroAPI.rawDistribution == null){
        return
    }
    let publiee
    try {
        const reponse = await fetch(require('./assets/js/distromanager').urlFraiche(), { cache: 'no-store' })
        if(!reponse.ok){
            return
        }
        publiee = await reponse.json()
    } catch(err) {
        return
    }
    const actuelle = DistroAPI.rawDistribution
    const liste = changementsMods(actuelle, publiee)
    if(JSON.stringify(actuelle.servers) === JSON.stringify(publiee.servers)){
        return
    }
    const distro = await DistroAPI.refreshDistributionOrFallback()
    onDistroRefresh(distro)
    if(liste.length === 0){
        return
    }
    loggerLanding.info('Mise à jour des mods publiée :', liste.join(', '))
    if(jeuEnCours()){
        majModsEnAttente = liste
        popupMaj('Mise à jour disponible', `${liste.join(', ')}. Redémarre ton jeu pour l'avoir : ferme Minecraft, `
            + 'la mise à jour s\'installe toute seule, puis relance avec Jouer.')
    } else {
        pageMajMods(liste)
    }
}

/** Le jeu vient de se fermer : on applique ce qui attendait (launcher d'abord, il se rouvre ensuite). */
const etatEnJeuOrigine = etatEnJeu
etatEnJeu = function(enJeu){
    etatEnJeuOrigine(enJeu)
    if(!enJeu){
        setTimeout(() => {
            if(jeuEnCours()){
                return
            }
            if(majLauncherEnAttente != null){
                const info = majLauncherEnAttente
                majLauncherEnAttente = null
                document.getElementById('senraPopupMaj')?.remove()
                proposerMaj(info)
            } else if(majModsEnAttente != null){
                pageMajMods(majModsEnAttente)
            }
        }, 800)
    }
}

setInterval(verifierMods, SURVEILLANCE_MODS)
