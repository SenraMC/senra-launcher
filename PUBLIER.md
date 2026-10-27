# Publier le Senra Launcher

Ce dossier (`launcher_senra/launcher`) devient le dépôt GitHub **SenraMC/senra-launcher**.
Les outils pour changer les mods restent sur ton PC, dans `launcher_senra/outils`.

Déjà réglé : le compte GitHub `SenraMC`, l'adresse `senra.mine.fun` (temporaire), le lien Discord, Senra Gravité.
Reste : la mise en ligne (étapes 1 à 3), la connexion Microsoft de Senra (étape 4).

---

## 1. Installer GitHub Desktop

1. Télécharge et installe **GitHub Desktop** : https://desktop.github.com
2. Ouvre-le et connecte-toi avec le compte **SenraMC** (*Sign in to GitHub.com*).
   Tu restes seul maître du compte : ne donne jamais ton mot de passe ni de jeton à personne.

## 2. Mettre le launcher en ligne (une seule fois)

1. Dans GitHub Desktop : menu **File → Add local repository…**
2. Clique **Choose…** et choisis le dossier :
   `C:\Users\Fayik\Desktop\model bb\launcher_senra\launcher`
3. GitHub Desktop dit que ce n'est pas encore un dépôt : clique le lien **create a repository**.
   - Laisse le nom proposé (`launcher`) et le chemin tels quels.
   - Clique **Create repository**.
4. En bas à gauche, écris un résumé, par exemple `Senra Launcher 1.0.0`, puis clique **Commit to main**.
   (Les dossiers `node_modules` et `dist` ne sont pas envoyés : c'est voulu.)
5. En haut, clique **Publish repository** :
   - **Name** : remplace `launcher` par `senra-launcher` (exactement).
   - **Décoche « Keep this code private »**. Le dépôt doit être public, sinon les joueurs ne reçoivent ni les mods ni les mises à jour.
   - Clique **Publish repository**.
6. Vérifie que cette adresse s'ouvre dans ton navigateur (elle affiche du texte) :
   https://raw.githubusercontent.com/SenraMC/senra-launcher/main/distribution/distribution.json

## 3. Construire les installeurs (Windows, macOS, Linux)

1. Va sur https://github.com/SenraMC/senra-launcher
2. À droite, **Releases → Create a new release** (ou *Draft a new release*).
   - **Choose a tag** : tape `v1.0.0` puis *Create new tag: v1.0.0 on publish*.
   - **Release title** : `Senra Launcher 1.0.0`.
   - Clique **Save draft** (ne publie pas encore).
3. Onglet **Actions** → à gauche **Construire le launcher** → bouton **Run workflow** → **Run workflow**.
   (Si GitHub demande d'activer les Actions, accepte.)
4. Attends que les trois tâches (Windows, macOS, Linux) soient vertes, environ 10 à 15 minutes.
   Les installeurs s'ajoutent tout seuls au brouillon de l'étape 2.
5. Retourne dans **Releases**, ouvre le brouillon `v1.0.0`, clique **Publish release**.

Le lien à donner aux joueurs : https://github.com/SenraMC/senra-launcher/releases/latest
(Windows : `Senra-Launcher-setup-1.0.0.exe` · macOS : le `.dmg` · Linux : l'`.AppImage`.)
Sur macOS, le launcher n'est pas signé par Apple : la première fois, il faut faire clic droit → *Ouvrir*.

## 4. Connexion Microsoft de Senra (avant de donner le launcher aux joueurs)

Le launcher utilise pour l'instant l'identifiant d'Helios, qui ne sert qu'aux essais.

1. Sur https://portal.azure.com, cherche **Microsoft Entra ID** dans la barre du haut et ouvre-le.
   (Pas besoin d'abonnement Azure : c'est gratuit.)
2. Menu de gauche, rubrique *Gérer* → **Inscriptions d'applications** → **+ Nouvelle inscription** :
   - **Nom** : `Senra Launcher`.
   - **Types de comptes pris en charge** : *Comptes dans un annuaire d'organisation (multilocataire) et comptes Microsoft personnels (Skype, Xbox…)*.
   - **URI de redirection** : laisse vide.
   - Clique **S'inscrire**.
3. Dans l'application créée, menu de gauche **Authentification** → **Ajouter une plateforme** → **Applications mobiles et de bureau** :
   coche ou saisis `https://login.microsoftonline.com/common/oauth2/nativeclient`, puis **Configurer**.
4. Menu de gauche **Certificats & secrets** → **Secrets client** → **+ Nouveau secret client** → description `Senra` → **Ajouter**.
   Microsoft l'exige, mais on ne s'en sert pas : ne le copie pas, ne le donne à personne.
5. Menu de gauche **Vue d'ensemble** : note l'**ID d'application (client)** et l'**ID de l'annuaire (locataire)**.
   Envoie-moi l'ID d'application, ou lance depuis `launcher_senra/outils` : `python configurer.py --azure CET_ID`.
6. **Obligatoire avant le formulaire** : ouvre le launcher avec ce nouvel ID et essaie de te connecter une fois. Une erreur est normale à ce stade : Microsoft veut voir de l'activité sur l'application avant de la valider.
7. Remplis le formulaire https://aka.ms/mce-reviewappid (« New AppID for Approval », avec les deux ID de l'étape 5).
   Mets comme e-mail de contact celui du compte affiché en haut à droite d'Azure.
8. Après l'accord de Microsoft, compte jusqu'à 24 h, puis envoie la modification sur GitHub (étape 5) et sors une nouvelle version (étape 6).

---

## 5. Changer les mods (sans nouvelle version du launcher)

1. Modifie `launcher_senra/outils/catalogue_mods.py` (ajouter, retirer, changer de catégorie, mods interdits).
2. Dans `gen_distribution.py`, monte `VERSION_PACK` (par exemple `1.0.1`), puis lance `python gen_distribution.py`.
3. GitHub Desktop → *Commit to main* → **Push origin**.

Les joueurs reçoivent les nouveaux mods au prochain lancement. Pour une nouvelle version de **Senra Gravité**, remplace `launcher_senra/outils/mods_maison/senra-gravity.jar` puis refais 2 et 3.
Pour l'**adresse définitive du serveur** : `python configurer.py --adresse NOUVELLE_ADRESSE`, puis 3.

## 6. Sortir une nouvelle version du launcher

1. Change `"version"` dans `package.json` (par exemple `1.0.1`), puis GitHub Desktop → *Commit* → *Push origin*.
2. Refais l'étape 3 avec le tag `v1.0.1`.

Les launchers déjà installés se mettent à jour tout seuls au démarrage suivant (Windows et Linux ; sur macOS, le launcher propose le lien de téléchargement).

## 7. Essayer le launcher sur ton PC

Double-clique `essayer.cmd` dans ce dossier. Il utilise la liste de mods de ton PC, pas celle de GitHub.

---
Basé sur [HeliosLauncher](https://github.com/dscalzi/HeliosLauncher) de Daniel Scalzi (licence MIT).
