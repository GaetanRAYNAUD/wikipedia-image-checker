/**
 * ===================================================================
 * Débogueur page_image_free Wikipédia
 * Moteur d'analyse client-side conforme à Extension:PageImages
 * ===================================================================
 */

// Configuration des seuils officiels de PageImages MediaWiki
const PAGEIMAGES_CONFIG = {
  scores: {
    position: [8, 6, 4, 3], // bonus pour les positions 0, 1, 2, 3
    width: {
      119: -100, // <= 119px : éliminé d'office
      400: 10,   // 120 à 400px : taille idéale (+10)
      600: 5,    // 401 à 600px : (+5)
      601: 0     // > 600px : (0)
    },
    galleryImageWidth: {
      99: -100,  // galerie <= 99px : éliminé
      100: 0     // galerie >= 100px : neutre
    },
    ratio: {
      3: -100,   // ratio <= 0.3 (ultra vertical) : éliminé
      5: 0,      // 0.4 à 0.5 : neutre
      20: 5,     // 0.6 à 2.0 (format photo standard) : (+5)
      30: 0,     // 2.1 à 3.0 : neutre
      31: -100   // ratio >= 3.1 (ultra panoramique) : éliminé
    }
  },
  // Liste noire par défaut pour fr.wikipedia.org (au cas où l'appel dynamique échoue)
  defaultDenylist: [
    'Defaut.svg',
    'Defaut_2.svg',
    'Defaut 2.svg',
    'Image_manquante.jpg',
    'Image manquante.jpg',
    'Image_manquante_2.svg',
    'Image manquante 2.svg',
    'Bâtiment_droit_d\'auteur.svg',
    'Bâtiment droit d\'auteur.svg',
    'Image_libre_bienvenue.png',
    'Image libre bienvenue.png',
    'No_image_available.svg',
    'Missing_image.png'
  ]
};

// Langue unique et obligatoire : Wikipédia en français
const WIKI_LANG = 'fr';

// Cache de la liste de blocage
const denylistCache = {};

// Éléments du DOM
const dom = {
  searchForm: document.getElementById('searchForm'),
  articleInput: document.getElementById('articleInput'),
  submitBtn: document.getElementById('submitBtn'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  
  loadingIndicator: document.getElementById('loadingIndicator'),
  loadingMessage: document.getElementById('loadingMessage'),
  errorBanner: document.getElementById('errorBanner'),
  errorMessage: document.getElementById('errorMessage'),
  
  resultsContainer: document.getElementById('resultsContainer'),
  verdictSection: document.getElementById('verdictSection'),
  verdictBadge: document.getElementById('verdictBadge'),
  verdictTitle: document.getElementById('verdictTitle'),
  verdictSubtitle: document.getElementById('verdictSubtitle'),
  verdictExplanation: document.getElementById('verdictExplanation'),
  recommendationsList: document.getElementById('recommendationsList'),
  verdictImageBox: document.getElementById('verdictImageBox'),
  verdictImage: document.getElementById('verdictImage'),
  verdictImageName: document.getElementById('verdictImageName'),
  
  candidatesTableBody: document.getElementById('candidatesTableBody'),
  noCandidatesMessage: document.getElementById('noCandidatesMessage'),
  toggleAllImages: document.getElementById('toggleAllImages')
};

// Variable globale pour stocker les résultats de l'analyse courante
let currentAnalysis = null;

// ===================================================================
// Initialisation & Gestionnaires d'événements
// ===================================================================

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  checkUrlParams();
});

function initTheme() {
  const savedTheme = localStorage.getItem('wikichecker_theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }
}

function updateThemeIcon(theme) {
  if (dom.themeToggleBtn) {
    dom.themeToggleBtn.querySelector('.theme-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
  }
}

function setupEventListeners() {
  // Soumission du formulaire
  dom.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const rawInput = dom.articleInput.value.trim();
    if (!rawInput) return;
    executeAnalysis(rawInput);
  });

  // Basculement thème sombre / clair
  dom.themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('wikichecker_theme', newTheme);
    updateThemeIcon(newTheme);
  });

  // Boutons d'exemples rapides
  document.querySelectorAll('.btn-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const title = btn.getAttribute('data-title');
      dom.articleInput.value = title;
      executeAnalysis(title);
    });
  });

  // Filtre "Afficher toutes les images / seulement l'intro"
  dom.toggleAllImages.addEventListener('change', () => {
    if (currentAnalysis) {
      renderCandidatesTable(currentAnalysis.candidates, dom.toggleAllImages.checked);
    }
  });
}

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const article = params.get('article') || params.get('title');
  if (article) {
    dom.articleInput.value = article;
    executeAnalysis(article);
  }
}

// ===================================================================
// Analyse et filtrage strict de l'entrée (Filtre d'URL & Titre)
// ===================================================================

function parseInput(rawInput) {
  const input = rawInput.trim();
  if (!input) {
    return { error: "Veuillez renseigner un titre ou une URL d'article." };
  }

  // Détection si l'utilisateur a collé une URL ou un nom de domaine
  const isUrlLike = /^https?:\/\//i.test(input) || /wikipedia\.org/i.test(input) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(input);

  if (isUrlLike) {
    let urlString = input;
    if (!/^https?:\/\//i.test(urlString)) {
      urlString = 'https://' + urlString;
    }

    try {
      const urlObj = new URL(urlString);
      const host = urlObj.hostname.toLowerCase();

      // FILTRE : Seules les URLs vers fr.wikipedia.org ou fr.m.wikipedia.org sont acceptées
      const isFrWiki = /^(?:fr|fr\.m)\.wikipedia\.org$/i.test(host);

      if (!isFrWiki) {
        // Détecter si c'est une autre langue de Wikipédia
        const otherWikiMatch = host.match(/^([a-z0-9_-]+)(?:\.m)?\.wikipedia\.org$/i);
        if (otherWikiMatch) {
          const otherLang = otherWikiMatch[1];
          return {
            error: `Le lien saisi provient de Wikipédia en langue "${otherLang}" (${host}). Cet outil est strictement configuré pour Wikipédia en français (fr.wikipedia.org). Veuillez renseigner le titre francophone ou un lien fr.wikipedia.org.`
          };
        } else {
          return {
            error: `L'URL "${host}" n'est pas un lien valide vers Wikipédia en français. Exemple valide : https://fr.wikipedia.org/wiki/Tour_Eiffel`
          };
        }
      }

      // Vérifier le chemin d'article (/wiki/...)
      const pathname = urlObj.pathname;
      const wikiMatch = pathname.match(/^\/wiki\/(.+)$/i);
      if (!wikiMatch || !wikiMatch[1]) {
        return {
          error: "L'URL fournie ne pointe pas vers un article de Wikipédia (le chemin doit être au format /wiki/Nom_Article). Exemple : https://fr.wikipedia.org/wiki/Infiniti_QX50"
        };
      }

      // Extraire le titre, supprimer les ancres (#...) et les paramètres
      const articlePart = wikiMatch[1].split('#')[0].split('?')[0];
      let title = '';
      try {
        title = decodeURIComponent(articlePart).replace(/_/g, ' ').trim();
      } catch (e) {
        title = articlePart.replace(/_/g, ' ').trim();
      }

      if (!title) {
        return { error: "Impossible d'extraire le titre de l'article depuis l'URL fournie." };
      }

      // Mettre à jour visuellement le champ avec le titre extrait
      dom.articleInput.value = title;
      return { title, isValid: true };

    } catch (err) {
      return {
        error: "Format d'URL invalide. Veuillez entrer un titre simple ou une URL valide (ex : https://fr.wikipedia.org/wiki/Tour_Eiffel)."
      };
    }
  }

  // Si ce n'est pas une URL : il s'agit d'un titre simple
  // Bloquer les éventuels préfixes interwiki comme "en:..."
  const interwikiPrefix = input.match(/^([a-z]{2,3}):(.+)$/i);
  if (interwikiPrefix && interwikiPrefix[1].toLowerCase() !== 'fr') {
    return {
      error: `Le préfixe de langue "${interwikiPrefix[1]}:" a été saisi. Cet outil est exclusivement réservé à Wikipédia en français.`
    };
  }

  const cleanTitle = input.replace(/^(?:fr:)/i, '').replace(/_/g, ' ').trim();
  return { title: cleanTitle, isValid: true };
}

// ===================================================================
// Récupération de la liste de blocage (Denylist sur fr.wikipedia.org)
// ===================================================================

async function fetchDenylist() {
  if (denylistCache[WIKI_LANG]) {
    return denylistCache[WIKI_LANG];
  }

  const endpoint = `https://${WIKI_LANG}.wikipedia.org/w/api.php?action=query&titles=MediaWiki:Pageimages-denylist|MediaWiki:Pageimages-blacklist&prop=revisions&rvprop=content&format=json&origin=*`;
  const list = new Set(PAGEIMAGES_CONFIG.defaultDenylist.map(normalizeFileName));

  try {
    const res = await fetch(endpoint);
    if (res.ok) {
      const data = await res.json();
      const pages = data?.query?.pages || {};
      for (const pageId in pages) {
        const page = pages[pageId];
        const content = page?.revisions?.[0]?.['*'] || '';
        // Analyse des lignes wikitext type "* [[:File:Nom.ext]]" ou "* [[:Fichier:Nom.ext]]"
        const regex = /\[\[:(?:File|Fichier|Image|Image):([^|\]#]+)/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          list.add(normalizeFileName(match[1].trim()));
        }
      }
    }
  } catch (err) {
    console.warn("Impossible de récupérer la liste noire en direct, utilisation de la liste par défaut :", err);
  }

  denylistCache[WIKI_LANG] = list;
  return list;
}

function normalizeFileName(name) {
  if (!name) return '';
  return name.replace(/^(?:File|Fichier|Image):/i, '').replace(/_/g, ' ').trim().toLowerCase();
}

// ===================================================================
// Cœur de l'analyse & Appels API Wikipédia (fr.wikipedia.org)
// ===================================================================

async function executeAnalysis(rawInput) {
  hideError();
  const parsed = parseInput(rawInput);
  if (parsed.error) {
    showError(parsed.error);
    hideLoading();
    dom.resultsContainer.classList.add('hidden');
    return;
  }

  const title = parsed.title;
  const lang = WIKI_LANG;

  // Mise à jour de l'URL du navigateur sans recharger la page (uniquement sur http/https pour supporter le protocole local file:///)
  try {
    if (window.location.protocol.startsWith('http')) {
      const newUrl = new URL(window.location);
      newUrl.searchParams.set('article', title);
      newUrl.searchParams.delete('lang');
      window.history.replaceState({}, '', newUrl);
    }
  } catch (e) {
    // Ignorer si le navigateur bloque replaceState en local (ex: file:///)
  }

  showLoading(`Analyse de l'article "${title}" sur Wikipédia en français...`);
  dom.resultsContainer.classList.add('hidden');

  try {
    const denylist = await fetchDenylist();

    // 1. Appel API Query Principal (Propriétés de la page, pageprops, pageimages)
    const queryUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages|pageprops|info&piprop=name|thumbnail|original&pilicense=any&ppprop=page_image|page_image_free|disambiguation&inprop=url&redirects=1&format=json&origin=*`;

    // 2. Appel API Parse Section 0 (Images et HTML de l'introduction)
    const parseUrl = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&section=0&prop=images|text&redirects=1&format=json&origin=*`;

    // 3. Appel API Liste de toutes les images de la page avec leurs métadonnées
    const imagesUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&generator=images&gimlimit=50&prop=imageinfo&iiprop=size|url|thumburl|mime|extmetadata&redirects=1&format=json&origin=*`;

    // Exécution parallèle des 3 requêtes
    const [queryRes, parseRes, imagesRes] = await Promise.all([
      fetch(queryUrl).then(r => r.json()),
      fetch(parseUrl).then(r => r.json()),
      fetch(imagesUrl).then(r => r.json()).catch(() => ({ query: { pages: {} } }))
    ]);

    // Traitement des données
    const pages = queryRes?.query?.pages || {};
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];

    if (!page || page.missing !== undefined) {
      showError(`L'article "${title}" n'existe pas sur Wikipédia en français. Vérifiez l'orthographe.`);
      hideLoading();
      return;
    }

    // Données de section 0
    const section0Images = parseRes?.parse?.images || [];
    const section0Html = parseRes?.parse?.text?.['*'] || '';

    // Index des métadonnées de toutes les images
    const imagesMetaMap = buildImagesMetaMap(imagesRes);

    // Extraction des attributs HTML des images en section 0 (tailles affichées, classes)
    const section0DomMap = extractImagesFromHtml(section0Html);

    // Évaluation de toutes les images
    const evaluatedCandidates = evaluateAllImages({
      allImageTitles: Object.keys(imagesMetaMap),
      section0Images,
      section0DomMap,
      imagesMetaMap,
      denylist,
      lang
    });

    // Synthèse du résultat
    currentAnalysis = {
      lang,
      originalTitle: title,
      resolvedTitle: page.title,
      pageId: page.pageid,
      pageUrl: page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
      redirected: Boolean(queryRes?.query?.redirects?.length),
      redirectSource: queryRes?.query?.redirects?.[0]?.from || null,
      isDisambiguation: Boolean(page.pageprops?.disambiguation !== undefined),
      pageImage: page.pageimage || page.pageprops?.page_image || null,
      pageImageFree: page.pageprops?.page_image_free || null,
      pageImageThumb: page.thumbnail?.source || null,
      candidates: evaluatedCandidates,
      section0ImagesCount: section0Images.length,
      totalImagesCount: Object.keys(imagesMetaMap).length
    };

    renderAnalysis(currentAnalysis);
    hideLoading();
    dom.resultsContainer.classList.remove('hidden');

  } catch (err) {
    console.error("Erreur durant l'analyse :", err);
    showError(`Une erreur s'est produite lors de l'appel à l'API Wikipédia : ${err.message}`);
    hideLoading();
  }
}

// ===================================================================
// Extraction et Mappage des Métadonnées d'Images
// ===================================================================

function buildImagesMetaMap(imagesRes) {
  const map = {};
  const pages = imagesRes?.query?.pages || {};
  for (const pid in pages) {
    const p = pages[pid];
    if (p.imageinfo && p.imageinfo[0]) {
      const cleanTitle = p.title.replace(/^(?:File|Fichier|Image):/i, '').replace(/_/g, ' ').trim();
      map[cleanTitle] = {
        title: cleanTitle,
        fullTitle: p.title,
        width: p.imageinfo[0].width || 0,
        height: p.imageinfo[0].height || 0,
        url: p.imageinfo[0].url || '',
        thumbUrl: p.imageinfo[0].thumburl || p.imageinfo[0].url || '',
        mime: p.imageinfo[0].mime || '',
        extmetadata: p.imageinfo[0].extmetadata || {}
      };
    }
  }
  return map;
}

function extractImagesFromHtml(html) {
  const map = {};
  if (!html) return map;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const imgs = doc.querySelectorAll('img');

  imgs.forEach(img => {
    // Trouver le nom de fichier à partir du src ou du lien parent
    let fileName = '';
    const link = img.closest('a');
    if (link && link.href) {
      const match = link.href.match(/(?:Fichier|File|Image):([^&?#/]+)/i);
      if (match) {
        try {
          fileName = decodeURIComponent(match[1]).replace(/_/g, ' ');
        } catch (e) {
          fileName = match[1].replace(/_/g, ' ');
        }
      }
    }
    if (!fileName && img.src) {
      const srcMatch = img.src.match(/\/thumb\/[^\/]+\/[^\/]+\/([^\/]+)\//i) || img.src.match(/\/([^\/]+)$/i);
      if (srcMatch) {
        try {
          fileName = decodeURIComponent(srcMatch[1]).replace(/_/g, ' ');
        } catch (e) {
          fileName = srcMatch[1].replace(/_/g, ' ');
        }
      }
    }

    if (fileName) {
      const cleanName = fileName.replace(/^(?:File|Fichier|Image):/i, '').trim();
      const parentFrame = img.closest('.thumb, .thumbinner, .gallerybox, figure') || img;
      const classes = `${img.className} ${parentFrame.className || ''}`.trim();
      
      const width = parseInt(img.getAttribute('width'), 10) || img.naturalWidth || parseInt(img.style.width, 10) || 0;
      const height = parseInt(img.getAttribute('height'), 10) || img.naturalHeight || parseInt(img.style.height, 10) || 0;
      const isGallery = Boolean(img.closest('.gallery') || img.closest('.gallerybox'));

      if (!map[cleanName]) {
        map[cleanName] = {
          displayedWidth: width,
          displayedHeight: height,
          classes: classes,
          isGallery: isGallery
        };
      }
    }
  });

  return map;
}

// ===================================================================
// Moteur de Calcul des Scores (Extension:PageImages MediaWiki)
// ===================================================================

function evaluateAllImages({ allImageTitles, section0Images, section0DomMap, imagesMetaMap, denylist, lang }) {
  // Liste combinée de toutes les images uniques
  const allImagesSet = new Set([...section0Images, ...allImageTitles]);
  const candidates = [];

  // Index de position pour les images de section 0
  const section0IndexMap = {};
  section0Images.forEach((imgName, idx) => {
    section0IndexMap[normalizeFileName(imgName)] = idx;
  });

  allImagesSet.forEach(rawName => {
    const cleanName = rawName.replace(/^(?:File|Fichier|Image):/i, '').replace(/_/g, ' ').trim();
    const normalized = normalizeFileName(cleanName);
    
    // Métadonnées
    const meta = imagesMetaMap[cleanName] || {
      title: cleanName,
      fullTitle: `Fichier:${cleanName}`,
      width: 0,
      height: 0,
      url: `https://${lang}.wikipedia.org/wiki/Sp%C3%A9cial:T%C3%A9l%C3%A9verser?wpDestFile=${encodeURIComponent(cleanName)}`,
      thumbUrl: '',
      mime: '',
      extmetadata: {}
    };

    // Est-elle en section 0 ?
    const inSection0 = section0IndexMap[normalized] !== undefined;
    const position = inSection0 ? section0IndexMap[normalized] : 999;

    // Attributs d'affichage HTML
    const domInfo = section0DomMap[cleanName] || {};
    const displayedWidth = domInfo.displayedWidth || meta.width || 0;
    const displayedHeight = domInfo.displayedHeight || meta.height || 0;
    const isGallery = Boolean(domInfo.isGallery);
    const classes = (domInfo.classes || '').split(/\s+/);

    // Calcul du score PageImages
    const scoreResult = calculatePageImageScore({
      fileName: cleanName,
      normalizedName: normalized,
      inSection0,
      position,
      fullWidth: meta.width,
      fullHeight: meta.height,
      displayedWidth,
      displayedHeight,
      isGallery,
      classes,
      denylist,
      extmetadata: meta.extmetadata
    });

    candidates.push({
      fileName: cleanName,
      inSection0,
      position,
      meta,
      displayedWidth,
      displayedHeight,
      isGallery,
      ...scoreResult
    });
  });

  // Trier les candidats : Section 0 en premier, puis par score décroissant
  candidates.sort((a, b) => {
    if (a.inSection0 && !b.inSection0) return -1;
    if (!a.inSection0 && b.inSection0) return 1;
    return b.totalScore - a.totalScore;
  });

  return candidates;
}

function calculatePageImageScore(params) {
  const {
    normalizedName,
    inSection0,
    position,
    fullWidth,
    fullHeight,
    displayedWidth,
    isGallery,
    classes,
    denylist,
    extmetadata
  } = params;

  let totalScore = 0;
  const breakdown = [];
  let isEliminated = false;
  let eliminationReason = null;

  // 1. Règle absolue : Présence tout en haut de page (Introduction ou Infobox)
  if (!inSection0) {
    return {
      totalScore: -9999,
      isFree: checkIsFree(extmetadata),
      isEliminated: true,
      eliminationReason: "Située plus bas dans l'article (hors introduction et infobox)",
      statusBadge: { text: "Plus bas dans l'article", type: "neutral" },
      breakdownText: "Image située après l'introduction"
    };
  }

  // 2. Vérification des images de remplacement bloquées (silhouette, image manquante)
  if (denylist.has(normalizedName)) {
    totalScore -= 1000;
    breakdown.push("Image d'attente bloquée : -1000");
    isEliminated = true;
    eliminationReason = "Silhouette ou image d'attente bloquée (ex: Defaut.svg, Image manquante)";
  }

  // 3. Classes manuelles
  if (classes.includes('notpageimage')) {
    totalScore -= 1000;
    breakdown.push("class='notpageimage' : -1000");
    isEliminated = true;
    eliminationReason = "Image volontairement exclue par les contributeurs (class='notpageimage')";
  }

  if (classes.includes('pageimage')) {
    totalScore += 1000;
    breakdown.push("class='pageimage' : +1000");
  }

  // 4. Score de Largeur
  let widthScore = 0;
  const evalWidth = displayedWidth || fullWidth;

  if (isGallery) {
    widthScore = evalWidth <= 99 ? -100 : 0;
    breakdown.push(`Galerie L=${evalWidth}px : ${widthScore >= 0 ? '+' : ''}${widthScore}`);
  } else {
    if (evalWidth <= 119) {
      widthScore = -100;
    } else if (evalWidth <= 400) {
      widthScore = 10;
    } else if (evalWidth <= 600) {
      widthScore = 5;
    } else {
      widthScore = 0;
    }
    breakdown.push(`Largeur ${evalWidth}px : ${widthScore >= 0 ? '+' : ''}${widthScore}`);
  }
  totalScore += widthScore;

  // 5. Score de Position
  const posScores = PAGEIMAGES_CONFIG.scores.position;
  const posScore = posScores[position] !== undefined ? posScores[position] : 0;
  if (posScore > 0) {
    breakdown.push(`Pos #${position + 1} : +${posScore}`);
  }
  totalScore += posScore;

  // 6. Score de Ratio (Aspect Ratio)
  let ratioScore = 0;
  let ratioValue = 0;
  if (fullWidth > 0 && fullHeight > 0) {
    const rawRatio = fullWidth / fullHeight;
    ratioValue = Math.floor(rawRatio * 10);

    if (ratioValue <= 3) {
      ratioScore = -100; // ratio <= 0.3
    } else if (ratioValue <= 5) {
      ratioScore = 0;    // 0.4 à 0.5
    } else if (ratioValue <= 20) {
      ratioScore = 5;    // 0.6 à 2.0 (idéal)
    } else if (ratioValue <= 30) {
      ratioScore = 0;    // 2.1 à 3.0
    } else {
      ratioScore = -100; // ratio >= 3.1
    }
    breakdown.push(`Ratio ${rawRatio.toFixed(2)} : ${ratioScore >= 0 ? '+' : ''}${ratioScore}`);
  }
  totalScore += ratioScore;

  // 7. Vérification de la licence libre
  const isFree = checkIsFree(extmetadata);

  // Évaluation finale
  if (!isEliminated) {
    if (totalScore < 0) {
      isEliminated = true;
      if (widthScore < 0) {
        eliminationReason = "Image trop petite (largeur inférieure à 120 px, ex: icône ou drapeau)";
      } else if (ratioScore < 0) {
        eliminationReason = "Format inadapté (photo trop étirée en largeur ou trop étroite en hauteur)";
      } else {
        eliminationReason = "Dimensions ou proportions jugées inadaptées par Wikipédia";
      }
    }
  }

  // Badge d'état
  let statusBadge = { text: "Qualifiée", type: "success" };
  if (isEliminated) {
    statusBadge = { text: "Éliminée", type: "error" };
  } else if (!isFree) {
    statusBadge = { text: "Non libre", type: "warning" };
  }

  return {
    totalScore,
    isFree,
    isEliminated,
    eliminationReason,
    statusBadge,
    breakdownText: breakdown.join(' | ')
  };
}

function checkIsFree(extmetadata) {
  if (!extmetadata) return true;
  // Si NonFree a la valeur "1", l'image n'est pas libre
  if (extmetadata.NonFree && (extmetadata.NonFree.value === '1' || extmetadata.NonFree.value === 1)) {
    return false;
  }
  // Vérification complémentaire des licences restrictives courantes
  const license = (extmetadata.LicenseShortName?.value || '').toLowerCase();
  if (license.includes('fair use') || license.includes('non-free') || license.includes('marque déposée')) {
    return false;
  }
  return true;
}

// ===================================================================
// Restitution Graphique des Résultats
// ===================================================================

function renderAnalysis(data) {
  // Diagnostic & Verdict
  generateVerdict(data);

  // Tableau des candidats
  renderCandidatesTable(data.candidates, dom.toggleAllImages.checked);
}


function generateVerdict(data) {
  const recommendations = [];
  let verdictType = 'error';
  let badgeText = 'Aucune image de présentation trouvée';
  let titleText = '';
  let subtitleText = '';
  let explanationHtml = '';

  // CAS 1 : Succès complet
  if (data.pageImageFree) {
    verdictType = 'success';
    badgeText = 'Bonne nouvelle : une photo libre est disponible !';
    titleText = `Cet article a bien une image de présentation libre de droits`;
    subtitleText = `Wikipédia a retenu « ${data.pageImageFree} » comme illustration principale de l'article.`;

    explanationHtml = `
      <p>
        <strong>Tout fonctionne normalement.</strong> Wikipédia a analysé le haut de l'article (l'infobox ou l'introduction) 
        et a retenu <strong>${escapeHtml(data.pageImageFree)}</strong> comme étant la meilleure photo libre disponible.
      </p>
    `;

    recommendations.push("Aucune action requise sur Wikipédia pour cet article.");
    recommendations.push(`Dans votre code ou requête API, utilisez <code>prop=pageimages&pilicense=free</code> pour récupérer cette image.`);

  } else {
    // CAS D'ÉCHEC : Pourquoi page_image_free est vide ?

    // Sous-cas A : Redirection sans redirects=1
    if (data.redirected) {
      recommendations.push(`Ce titre est une redirection vers un autre article. Si vous utilisez l'API de Wikipédia, pensez à inclure le paramètre <code>redirects=1</code> pour que la redirection soit suivie automatiquement.`);
    }

    // Sous-cas B : Homonymie
    if (data.isDisambiguation) {
      titleText = "Page d'homonymie sans illustration principale";
      subtitleText = "Les pages d'homonymie servent à lister plusieurs sujets et ne comportent pas d'image représentative.";
      explanationHtml = `
        <p>Cet article est une <strong>page d'homonymie</strong>. Wikipédia ne lui attribue pas d'image principale.</p>
      `;
      recommendations.push("Consultez directement les articles cibles listés sur cette page d'homonymie.");
    }
    // Sous-cas C : L'image globale existe mais n'est pas libre (page_image existe, page_image_free est vide)
    else if (data.pageImage) {
      verdictType = 'warning';
      badgeText = 'Attention : Image non libre';
      titleText = `L'image principale est protégée par le droit d'auteur (non libre)`;
      subtitleText = `Une image illustre bien l'article ("${data.pageImage}"), mais elle ne peut pas être fournie dans page_image_free.`;

      explanationHtml = `
        <p>
          L'article possède bien une illustration tout en haut de page (<strong>${escapeHtml(data.pageImage)}</strong>), 
          mais celle-ci n'est <strong>pas sous licence libre</strong> (il s'agit par exemple d'un logo de marque déposée, d'une affiche ou d'une exception de courte citation).
        </p>
        <p>
          Pour protéger les personnes et applications externes contre les risques juridiques liés au droit d'auteur, 
          Wikipédia réserve strictement le champ <code>page_image_free</code> aux <strong>fichiers libres de droits</strong> 
          (placés sous licence Creative Commons ou dans le Domaine Public sur Wikimedia Commons).
        </p>
      `;

      recommendations.push("Téléverser ou utiliser une photographie sous licence libre (CC-BY-SA) sur Wikimedia Commons pour illustrer l'article.");
      recommendations.push("Si votre application a le droit d'afficher des images sous droit d'auteur (fair use ou exception de citation), interrogez l'API avec <code>pilicense=any</code> au lieu de <code>pilicense=free</code> pour obtenir le champ <code>page_image</code>.");

    } 
    // Sous-cas D : Zéro image dans toute la page
    else if (data.totalImagesCount === 0) {
      titleText = "Cet article ne comporte aucune image";
      subtitleText = "Aucune illustration n'a été ajoutée sur l'ensemble de la page.";
      explanationHtml = `
        <p>
          L'article ne contient aucune photo, dessin ou schéma, ni dans l'infobox ni dans le corps du texte.
        </p>
      `;
      recommendations.push("Ajouter une image pertinente dans l'infobox principale ou au tout début de l'article sur Wikipédia.");
    }
    // Sous-cas E : Des images dans l'article, mais AUCUNE dans l'intro / infobox
    else if (data.section0ImagesCount === 0 && data.totalImagesCount > 0) {
      titleText = "Aucune image dans l'introduction ou l'infobox";
      subtitleText = `L'article contient bien ${data.totalImagesCount} image(s), mais elles sont toutes placées plus bas dans le texte.`;

      explanationHtml = `
        <p>
          C'est l'explication la plus fréquente : pour choisir l'image principale d'un article, Wikipédia <strong>ne regarde que le tout début de la page</strong>. L'image doit obligatoirement se trouver :
        </p>
        <ul style="margin: 8px 0 8px 20px;">
          <li>Soit dans l'<strong>infobox</strong> (le cadre récapitulatif situé en haut à droite).</li>
          <li>Soit dans le <strong>texte d'introduction</strong> (avant le tout premier titre de chapitre).</li>
        </ul>
        <p>
          Même si cet article contient de très belles photos plus bas (dans les chapitres <em>Histoire</em>, <em>Galerie</em> ou <em>Description</em>), Wikipédia <strong>les ignore totalement</strong> pour l'image de présentation.
        </p>
      `;

      recommendations.push("Placer une photo principale dans l'infobox de l'article (le cadre à droite) ou tout au début du premier paragraphe d'introduction.");
      recommendations.push("Sur les articles sans infobox, insérer une image tout en haut de l'article avant le premier titre de section.");
      recommendations.push("Après modification sur Wikipédia, la mise à jour des aperçus et du champ de l'API est automatique sous quelques minutes.");

    } 
    // Sous-cas F : Des images en intro, mais toutes éliminées
    else {
      titleText = "Les images situées en haut de page ne sont pas utilisables";
      subtitleText = `Des images sont bien présentes en introduction ou dans l'infobox, mais elles ne respectent pas les critères d'illustration de Wikipédia.`;

      const reasons = [];
      data.candidates.filter(c => c.inSection0).forEach(c => {
        if (c.eliminationReason) reasons.push(`<strong>${escapeHtml(c.fileName)}</strong> : ${c.eliminationReason}`);
      });

      explanationHtml = `
        <p>
          Des images se trouvent bien tout en haut de la page, mais Wikipédia les a écartées pour les raisons suivantes :
        </p>
        <ul style="margin: 8px 0 8px 20px;">
          ${reasons.map(r => `<li>${r}</li>`).join('')}
        </ul>
        <p>
          <strong>Pourquoi ces rejets ?</strong> Wikipédia applique des règles de qualité pour éviter de mauvaises vignettes :
        </p>
        <ul style="margin: 8px 0 8px 20px;">
          <li>Les images trop petites (largeur inférieure à 120 pixels, comme les petits drapeaux, mini-logos ou icônes de modèles) sont systématiquement rejetées.</li>
          <li>Les silhouettes génériques par défaut ou logos « Image manquante » sont bloqués.</li>
          <li>Les photos excessivement étirées (panoramiques très larges ou colonnes très étroites) sont écartées.</li>
        </ul>
      `;

      recommendations.push("Remplacer la silhouette ou l'image d'attente par une véritable photographie libre.");
      recommendations.push("Veiller à ce que la photo principale ait une taille normale (au moins 200 à 300 pixels de large, taille standard d'une infobox).");
      recommendations.push("Privilégier une photo aux proportions classiques (format paysage ou portrait usuel).");
      recommendations.push("Option avancée : Sur Wikipédia, vous pouvez forcer la sélection d'une image en ajoutant <code>|class=pageimage</code> dans son code.");
    }
  }

  // Appliquer le style au conteneur de verdict
  dom.verdictSection.className = `verdict-card verdict-${verdictType}`;
  dom.verdictBadge.className = `badge badge-${verdictType}`;
  dom.verdictBadge.textContent = badgeText;
  dom.verdictTitle.textContent = titleText;
  dom.verdictSubtitle.textContent = subtitleText;
  dom.verdictExplanation.innerHTML = explanationHtml;

  // Afficher l'image de présentation retenue (libre en priorité, sinon non libre)
  renderVerdictImage(data.pageImageFree || data.pageImage, data.lang, verdictType);

  // Remplir les recommandations
  dom.recommendationsList.innerHTML = recommendations.map(r => `<li>${r}</li>`).join('');
}

function renderVerdictImage(fileName, lang, verdictType) {
  if (!fileName) {
    dom.verdictImageBox.classList.add('hidden');
    dom.verdictImage.removeAttribute('src');
    dom.verdictImageName.textContent = '';
    return;
  }

  const cleanName = fileName.replace(/_/g, ' ');
  dom.verdictImageBox.className = `verdict-image-box verdict-image-${verdictType}`;
  dom.verdictImage.onerror = () => dom.verdictImageBox.classList.add('hidden');
  dom.verdictImage.src = `https://${lang}.wikipedia.org/wiki/Special:Redirect/file/${encodeURIComponent(cleanName)}?width=240`;
  dom.verdictImage.alt = cleanName;
  dom.verdictImageName.textContent = cleanName;
  dom.verdictImageName.title = cleanName;
  dom.verdictImageName.href = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(`Fichier:${cleanName}`)}`;
}

function renderCandidatesTable(candidates, showAll) {
  dom.candidatesTableBody.innerHTML = '';

  // Filtrer selon la case à cocher
  const listToDisplay = showAll ? candidates : candidates.filter(c => c.inSection0);

  if (listToDisplay.length === 0) {
    dom.candidatesTableBody.parentElement.classList.add('hidden');
    dom.noCandidatesMessage.classList.remove('hidden');
    if (!showAll && candidates.length > 0) {
      dom.noCandidatesMessage.textContent = `Aucune image tout en haut de la page (dans l'introduction ou l'infobox). Cochez la case ci-dessus pour afficher les ${candidates.length} image(s) situées plus bas dans l'article.`;
    } else {
      dom.noCandidatesMessage.textContent = "Aucune image trouvée pour cet article.";
    }
    return;
  }

  dom.candidatesTableBody.parentElement.classList.remove('hidden');
  dom.noCandidatesMessage.classList.add('hidden');

  listToDisplay.forEach(c => {
    const tr = document.createElement('tr');
    
    // Miniature
    const thumbHtml = c.meta.url ? `
      <div class="candidate-thumb-box">
        <img src="https://${currentAnalysis.lang}.wikipedia.org/wiki/Special:Redirect/file/${encodeURIComponent(c.fileName)}?width=100" 
             alt="Miniature" 
             onerror="this.parentElement.innerHTML='<span class=\\'no-preview\\'>🖼️</span>'">
      </div>
    ` : '<span class="no-preview">🖼️</span>';

    // Nom et lien
    const fileLink = `https://${currentAnalysis.lang}.wikipedia.org/wiki/${encodeURIComponent(c.meta.fullTitle || `Fichier:${c.fileName}`)}`;
    
    // Section
    const sectionBadge = c.inSection0 ? 
      `<span class="badge badge-info">En haut (Intro / Infobox)</span>` : 
      `<span class="badge badge-neutral">Plus bas dans l'article</span>`;

    // Licence
    const licenseBadge = c.isFree ? 
      `<span class="badge badge-success">Libre</span>` : 
      `<span class="badge badge-warning" title="Marquée NonFree=1 ou copyright">Non libre</span>`;

    // Décision
    const decisionBadge = `<span class="badge badge-${c.statusBadge.type}">${c.statusBadge.text}</span>`;

    // Dimensions
    const dims = `${c.displayedWidth || c.meta.width} × ${c.displayedHeight || c.meta.height} px`;
    const ratio = (c.meta.width && c.meta.height) ? `(r: ${(c.meta.width / c.meta.height).toFixed(2)})` : '';

    tr.innerHTML = `
      <td>${thumbHtml}</td>
      <td class="candidate-file-cell">
        <a href="${fileLink}" target="_blank" rel="noopener" class="candidate-file-name" title="${escapeHtml(c.fileName)}">
          ${escapeHtml(c.fileName)}
        </a>
        <div class="candidate-file-desc">${c.isGallery ? 'Image en galerie' : 'Image autonome'}</div>
      </td>
      <td>${sectionBadge}</td>
      <td>
        <div>${dims}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">${ratio}</div>
      </td>
      <td>${licenseBadge}</td>
      <td>
        <div class="score-breakdown">${escapeHtml(c.breakdownText)}</div>
        ${c.eliminationReason ? `<div style="color:var(--error); font-size:0.75rem; margin-top:2px;">⚠️ ${escapeHtml(c.eliminationReason)}</div>` : ''}
      </td>
      <td>
        <span class="score-total ${c.totalScore >= 0 ? 'positive' : 'negative'}">
          ${c.totalScore > -9000 ? (c.totalScore >= 0 ? `+${c.totalScore}` : c.totalScore) : '—'}
        </span>
      </td>
      <td>${decisionBadge}</td>
    `;

    dom.candidatesTableBody.appendChild(tr);
  });
}

// ===================================================================
// Utilitaires
// ===================================================================

function showLoading(msg) {
  dom.loadingMessage.textContent = msg || 'Chargement...';
  dom.loadingIndicator.classList.remove('hidden');
  dom.submitBtn.disabled = true;
}

function hideLoading() {
  dom.loadingIndicator.classList.add('hidden');
  dom.submitBtn.disabled = false;
}

function showError(msg) {
  dom.errorMessage.textContent = msg;
  dom.errorBanner.classList.remove('hidden');
}

function hideError() {
  dom.errorBanner.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
