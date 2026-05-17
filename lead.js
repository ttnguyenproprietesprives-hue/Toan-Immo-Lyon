# Toan Immo Lyon — Outil d'estimation immobilière

## Structure du projet
```
toan-immo-lyon/
├── index.html          ← La page principale (l'outil)
├── vercel.json         ← Configuration Vercel
├── api/
│   ├── estimate.js     ← Backend sécurisé (appel API Claude)
│   └── lead.js         ← Réception des leads (envoi email)
└── LIRE-MOI.md         ← Ce fichier
```

---

## Déploiement sur Vercel — étape par étape

### ÉTAPE 1 — Préparer ton dossier
- Télécharge ce dossier complet sur ton ordinateur
- Ne modifie rien pour l'instant

### ÉTAPE 2 — Créer un compte Formspree (pour recevoir les leads par email)
1. Va sur https://formspree.io
2. Crée un compte gratuit avec ton email
3. Clique "New Form" → donne-lui un nom ("Leads Toan Immo")
4. Copie l'ID du formulaire (ex: "xyzabc12") — tu en auras besoin à l'étape 4

### ÉTAPE 3 — Créer un compte GitHub (nécessaire pour Vercel)
1. Va sur https://github.com
2. Crée un compte gratuit
3. Clique "New repository" (bouton vert)
4. Nom : "toan-immo-lyon" — coche "Public" — clique "Create repository"
5. Clique "uploading an existing file"
6. Glisse-dépose TOUT le contenu du dossier (index.html, vercel.json, dossier api/)
7. Clique "Commit changes"

### ÉTAPE 4 — Déployer sur Vercel
1. Va sur https://vercel.com et connecte-toi avec ton compte GitHub
2. Clique "Add New Project"
3. Trouve "toan-immo-lyon" dans la liste → clique "Import"
4. Clique "Deploy" (sans rien changer)
5. Attends 1 minute → ton site est en ligne !

### ÉTAPE 5 — Ajouter tes clés secrètes (IMPORTANT)
1. Dans Vercel, va dans ton projet → "Settings" → "Environment Variables"
2. Ajoute ces deux variables :

   Nom : ANTHROPIC_API_KEY
   Valeur : sk-ant-xxxx (ta clé API Anthropic)

   Nom : FORMSPREE_ID
   Valeur : xyzabc12 (ton ID Formspree de l'étape 2)

3. Clique "Save"
4. Va dans "Deployments" → clique "Redeploy" pour appliquer les changements

### ÉTAPE 6 — Connecter ton nom de domaine (optionnel)
1. Dans Vercel → Settings → Domains
2. Tape ton domaine (ex: toanimmo-lyon.fr)
3. Vercel te donne les DNS à configurer chez OVH
4. Dans OVH → Zone DNS → modifie l'entrée selon les instructions Vercel
5. Attends 24h maximum → ton domaine pointe sur ton site

---

## En cas de problème
- L'outil ne répond pas → vérifie que ANTHROPIC_API_KEY est bien renseignée dans Vercel
- Les leads n'arrivent pas → vérifie que FORMSPREE_ID est correct
- Page blanche → va dans Vercel → "Logs" pour voir l'erreur

---

Développé pour Toan Immo Lyon · Conseiller immobilier indépendant · Grand Lyon
