# 🔍 Débogueur `page_image_free` Wikipédia

Une application web moderne, légère et 100% côté client (HTML / CSS / JavaScript vanilla) permettant de diagnostiquer pourquoi l'API MediaWiki (`action=query`) ne retourne pas d'image dans la propriété `page_image_free` pour un article donné.

Conçue exclusivement pour **Wikipédia en français** (`fr.wikipedia.org`), elle intègre un filtre de validation strict sur les liens et est directement déployable sur **GitHub Pages**.

---

## 🎯 Pourquoi `page_image_free` est-il souvent vide ?

Lorsqu'on interroge l'API Wikipédia avec `action=query&prop=pageimages|pageprops`, beaucoup de développeurs et contributeurs constatent avec surprise que le champ `page_image_free` (ou `thumbnail` avec `pilicense=free`) est vide alors même que l'article contient des images.

D'après le code source officiel de l'extension MediaWiki [Extension:PageImages](https://www.mediawiki.org/wiki/Extension:PageImages) et la configuration appliquée sur les projets Wikimedia :

1. **La règle du résumé introductif (`$wgPageImagesLeadSectionOnly = true`) :**
   Seules les images situées dans la **section 0** (l'introduction et l'infobox principale avant le premier titre de section) sont considérées comme candidates. Si un article contient 30 photos mais aucune dans l'introduction, **`page_image_free` reste vide**.
2. **La taille minimale d'affichage (120 px) :**
   Toute image ayant une largeur d'affichage $\le 119\text{ px}$ reçoit une pénalité éliminatoire de **-100 points**. Cela écarte automatiquement les icônes de portails, drapeaux de modèles et bandeaux d'ébauches.
3. **Le ratio d'aspect (trop panoramique ou trop haut) :**
   Les bannières très étirées (ratio $\ge 3.1$) ou colonnes très étroites (ratio $\le 0.3$) reçoivent **-100 points**.
4. **La liste noire des images de substitution (`MediaWiki:Pageimages-denylist`) :**
   Sur `fr.wikipedia.org`, des images comme `Defaut.svg`, `Defaut 2.svg`, `Image manquante.jpg` sont bloquées d'office avec **-1000 points**.
5. **Image présente mais non-libre (`NonFree = 1`) :**
   Si l'image de l'article est un logo sous marque déposée ou une exception locale au droit d'auteur (fair use), elle est attribuée à `page_image` (toute licence), mais **rejetée de `page_image_free`** qui est strictement réservé aux licences libres (Creative Commons / Domaine Public).
6. **Redirections non suivies :**
   Si le titre est une redirection et que la requête API omet `redirects=1`, l'API retourne la page de redirection sans image.

---

## ✨ Fonctionnalités de l'outil

- **Saisie flexible & Filtre d'URL** : Saisissez soit un simple titre (ex: `Infiniti QX50`, `Tour Eiffel`), soit une URL complète. Les URLs externes ou d'autres langues Wikipédia (ex: `en.wikipedia.org`) sont automatiquement filtrées avec un message d'explication.
- **Ciblage exclusif de Wikipédia en français** (`fr.wikipedia.org`).
- **Verdict pédagogique instantané** : Explication claire en français de la cause exacte du problème.
- **Recommandations concrètes** : Conseils d'édition Wikipédia pour résoudre la situation ou options de requêtes API pour vos développements.
- **Comparatif des propriétés API** : Visualisation en parallèle de `page_image_free` (libre), `page_image` (toutes licences) et de la miniature.
- **Tableau de scoring détaillé** : Affiche toutes les images analysées avec leurs dimensions, leur ratio, le détail point par point de leur score et leur statut d'élimination.
- **Inspecteur de requêtes API** : Affiche les URL complètes appelées avec liens directs et la réponse JSON brute pour faciliter l'intégration dans vos propres scripts.
- **Exemples intégrés en un clic** pour tester immédiatement les cas classiques.
- **Mode sombre / clair automatique** avec basculement manuel et mémorisation.

---

## 🚀 Utilisation en local

Puisque l'application n'utilise aucun backend et que l'API Wikipédia autorise nativement le CORS (`origin=*`), vous pouvez l'utiliser directement :

1. Ouvrez simplement le fichier `index.html` dans votre navigateur web préféré (double-clic).
2. Ou lancez un serveur local léger si vous préférez :
   ```bash
   # Avec Python :
   python -m http.server 8000
   # Puis ouvrir http://localhost:8000
   ```

---

## 🌐 Déploiement sur GitHub Pages

Pour mettre en ligne cet outil sur GitHub Pages :

1. Initialisez un dépôt Git dans ce dossier et envoyez-le sur GitHub :
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Débogueur page_image_free"
   git branch -M main
   git remote add origin https://github.com/<votre-utilisateur>/wikipedia-image-checker.git
   git push -u origin main
   ```
2. Sur GitHub, rendez-vous dans les paramètres du dépôt :
   - Onglet **Settings** > **Pages** (dans le menu de gauche).
   - Sous **Build and deployment** :
     - **Source** : `Deploy from a branch`
     - **Branch** : `main` / `/ (root)`
   - Cliquez sur **Save**.
3. Votre site sera disponible publiquement sous quelques instants à l'adresse :
   `https://<votre-utilisateur>.github.io/wikipedia-image-checker/`

---

## 📚 Références & Sources

- [MediaWiki Extension:PageImages](https://www.mediawiki.org/wiki/Extension:PageImages)
- [Wikipédia: Page image selection](https://en.wikipedia.org/wiki/Wikipedia:Page_image_selection)
- [Code source de PageImages (Gerrit/Wikimedia)](https://gerrit.wikimedia.org/g/mediawiki/extensions/PageImages)
- [Liste de blocage active de Wikipédia en français (`MediaWiki:Pageimages-denylist`)](https://fr.wikipedia.org/wiki/MediaWiki:Pageimages-denylist)
