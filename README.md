# Forever Healing

Version autonome du guide interactif des healers de WoW Forever, en français. Le site conserve les six fiches validées, leurs icônes, les tooltips au survol et au clic, le lexique, la FSR, les conseils de leveling et les sources.

Le serveur utilise **Node.js 24**, ses modules natifs et **aucune dépendance npm externe**. Les images et les données sont incluses. Aucune connexion à ChatGPT n’est nécessaire pour démarrer ou consulter le site. Les liens vers les sources restent des liens externes.

## Structure

```text
public/                       Source du site, données et images
server.mjs                    Serveur HTTP Node.js
scripts/build.mjs             Copie contrôlée de public/ vers dist/
scripts/check.mjs             Syntaxe, données et présence des images
scripts/healthcheck.mjs        Contrôle de santé local
scripts/smoke.mjs              Contrôles HTTP d’une instance démarrée
test/server.test.mjs           Tests du serveur HTTP
package.json
package-lock.json
Dockerfile
.dockerignore
compose.yml                   Production derrière le Traefik existant
compose.dev.yml               Test Docker local, sans Traefik
.env.example
.github/workflows/image.yml   Tests, construction et publication GHCR
THIRD_PARTY_NOTICES.md
```

`dist/` est généré par `npm run build` et n’est pas à modifier directement. La configuration et les identifiants de l’ancien hébergement ont été exclus de cet export.

## Développement local

Prérequis : Node.js 24 et npm. La version Node est indiquée dans `.nvmrc`. Le fichier de verrouillage doit rester versionné.

Sous PowerShell :

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

Sous Linux/macOS :

```bash
cp .env.example .env
npm ci
npm run dev
```

Ouvrir `http://127.0.0.1:3000`. Le mode développement sert directement `public/`. Node redémarre lorsque le serveur est modifié ; rafraîchir le navigateur après une modification HTML/CSS/JS ou des données. Les réglages GHCR/Traefik de `.env` ne sont pas utilisés par le serveur local.

Pour exécuter le mode production sans Docker :

```bash
npm ci
npm run check
npm test
npm run build
npm start
```

`npm start` sert `dist/` : lancer le build au préalable. Depuis un second terminal :

```bash
npm run healthcheck
node scripts/smoke.mjs
```

Les scripts utilisent les chemins du projet, y compris si le projet contient des espaces. L’exemple `.env` lie le serveur local à `127.0.0.1`. Pour le rendre accessible sur le réseau local, définir `HOST=0.0.0.0`.

## Tester Docker localement

Prérequis : Docker Engine/Desktop avec Docker Compose **v2.20 ou plus récent**. Le test local n’a besoin ni d’un domaine, ni d’un réseau Traefik, ni d’une image GHCR.

```bash
docker compose -f compose.dev.yml up --build -d --wait
docker compose -f compose.dev.yml ps
docker compose -f compose.dev.yml exec -T web node scripts/healthcheck.mjs
```

Ouvrir `http://127.0.0.1:3000`. `LOCAL_PORT` permet de changer le port publié localement. Arrêter ce projet avec :

```bash
docker compose -f compose.dev.yml down
```

Ce fichier Compose est indépendant du fichier de production. Il construit une image de production locale, sans montage du code source.

## Réglages

Copier `.env.example` vers `.env`, puis adapter :

| Variable | Rôle |
| --- | --- |
| `IMAGE_REF` | **Requis pour la production.** Référence GHCR avec digest `@sha256:…`. La commande de release refuse tags et placeholders. |
| `LOG_LEVEL` | `info`, `error` ou `silent`. Défaut : `info`. |
| `HOST`, `PORT` | Écoute du serveur lancé directement avec npm. Dans Docker, Compose impose `0.0.0.0:3000`. |
| `LOCAL_PORT` | Port hôte utilisé uniquement par `compose.dev.yml`. Défaut : `3000`, sur loopback. |

`APP_VERSION` est fixé à la construction de l’image par le workflow, à partir du SHA Git. Il apparaît dans le JSON des health checks. Aucun secret applicatif n’est requis. Un jeton GHCR de lecture peut être nécessaire pour **récupérer une image privée**, via `docker login`, sans le mettre dans `.env`.

Ne pas versionner `.env`. Les valeurs Compose ne sont pas injectées dans le JavaScript envoyé au navigateur.

## Dépôt GitHub et publication GHCR

L’origin configuré est `https://github.com/LyeosMaouli/lm-wow-forever-healer.git`. Confirmer la visibilité du dépôt et du package avant publication, puis versionner les fichiers commençant par un point avec le reste du code. Ces corrections ne créent aucun dépôt distant, ne poussent aucun commit et ne publient aucune image.

Le workflow `image.yml` :

1. Sur une pull request vers `main`, exécute les contrôles, les tests Node, le build et un test du conteneur. Il ne publie pas d’image.
2. Sur un push vers `main`, un tag `v*`, ou un déclenchement manuel depuis `main`, répète ces vérifications puis publie dans `ghcr.io/<propriétaire>/<dépôt>` ; le nom est converti en minuscules.
3. Produit un tag `sha-<SHA Git complet>`, un tag `edge` pour la branche par défaut et un tag de version sur les tags SemVer tels que `v1.0.0`. Aucun tag `latest` n’est produit.
4. Construit une seule image, teste celle-ci puis pousse le même ID sans deuxième build. Affiche dans le résumé du job une référence `IMAGE_REF=ghcr.io/…@sha256:…` pour le déploiement manuel.

Les builds du workflow ciblent `linux/amd64`, adapté à un VPS x86-64. Pour un serveur ARM, adapter les champs `platforms` et la validation correspondante.

L’authentification de publication utilise le `GITHUB_TOKEN` fourni par GitHub avec `packages: write`. Aucun jeton personnel ni secret SSH n’est nécessaire pour cette CI. Vérifier que GitHub Actions est autorisé dans le dépôt et que la politique de l’organisation permet ces actions et la publication de packages. Sur une première publication, GitHub peut créer le package en privé ; sa visibilité se gère ensuite dans ses paramètres.

Le workflow n’accède **jamais au VPS** et ne lance aucun déploiement. `workflow_dispatch` relance seulement la construction/publication. Les actions sont fixées à des commits complets ; Node est fixé à 24.22.2 dans `.nvmrc` et son image Alpine 3.24 est fixée par digest. Mettre ces références à jour explicitement, puis refaire les contrôles. La publication de l’image chargée et testée ne fournit pas d’attestations SBOM/provenance attachées et ne prétend pas le faire. Les tests de publication utilisent un Docker simulé ; la publication réelle GHCR reste à vérifier.

## Déploiement manuel sur le VPS avec Traefik

Le projet Compose est fixé à `forever-healing`, sous `/opt/websites/forever-healing`. Son service public rejoint **`hosting-ingress-forever-healing`** avec l’alias unique **`forever-healing-public`**, sans port publié. Le réseau `private` reste interne. Traefik utilise le **provider fichier**, avec une route d’infrastructure vers `http://forever-healing-public:3000` et un health check `/healthz`. Aucun label de découverte Docker n’est requis.

Le dépôt d’infrastructure `lm-servers-muffins` fournit `playbooks/prepare-forever-healing.yml`, la commande de release et les instructions détaillées dans **`docs/website-releases.md`**. Le dépôt du site reste propriétaire de son Compose. Préparer une copie Linux revue de ce dépôt dans Ubuntu WSL2, puis renseigner dans l’inventaire local d’infrastructure :

```yaml
hosting_site_checkout: /root/hosting-control/forever-healing-source
hosting_site_image_repository: ghcr.io/lyeosmaouli/lm-wow-forever-healer
```

Depuis la copie Linux du dépôt d’infrastructure, avec son environnement Ansible activé :

```bash
ansible-playbook -i inventory/hosts.local.yml playbooks/prepare-forever-healing.yml --syntax-check
ansible-lint --offline playbooks/prepare-forever-healing.yml
ansible-playbook -i inventory/hosts.local.yml playbooks/prepare-forever-healing.yml
```

Ce playbook installe les fichiers revus appartenant à root et prépare la route hors du répertoire surveillé. Il ne démarre aucun site et ne recrée pas Traefik. Le réseau d’ingress doit déjà exister. Le compte de déploiement ne doit pas pouvoir modifier les configurations exécutées avec les privilèges Docker.

Après publication d’une image validée, dans la session SSH de l’administrateur sur le **VPS** :

```bash
sudo /usr/local/sbin/hosting-release deploy forever-healing \
  ghcr.io/lyeosmaouli/lm-wow-forever-healer@sha256:REPLACE_WITH_CI_DIGEST
```

Le placeholder est volontairement rejeté. Pour une image privée, utiliser au préalable `sudo -H docker login ghcr.io` et saisir le jeton au prompt, sans l’inscrire dans Git, Compose ou une commande. Les identifiants sont ceux de root pour cette opération administrative.

La commande de release tient un verrou par site, accepte seulement un digest du dépôt autorisé, valide Compose sans l’afficher, tire l’image et attend sa santé. Elle active la route atomiquement sans redémarrer Traefik, puis vérifie HTTPS de confiance, le contenu HTML et le SHA complet de `/healthz`. Après le premier succès, définir `hosting_https_expected_status: 200` dans les inventaires Windows et WSL de l’infrastructure, au lieu du 404 initial.

Le conteneur s’exécute avec l’utilisateur `node`, un système de fichiers en lecture seule, toutes les capabilities supprimées, `no-new-privileges`, une limite mémoire de 256 Mio et une limite de processus. L’arrêt SIGTERM laisse finir les requêtes, avec fermeture forcée après 10 secondes au maximum. Les logs sont limités à trois fichiers de 10 Mo.

**Accès au site :** ce serveur autonome ne reprend pas la restriction d’accès privé de ChatGPT. Les visiteurs autorisés par votre réseau/proxy peuvent consulter le site. Pour conserver un accès réservé, ajouter un middleware d’authentification dans votre Traefik avant de l’exposer au public. Aucun système de compte n’est inclus dans l’application.

## Health checks et diagnostic

| Route | Fonction |
| --- | --- |
| `GET /healthz` | Readiness : le serveur répond et le fichier d’entrée est accessible. HTTP 200 ou 503. |
| `GET /readyz` | Même contrôle que `/healthz`. |
| `GET /livez` | Liveness du processus HTTP. |

Exemple de réponse : `{"status":"ok","version":"<SHA Git>"}`. Les réponses de santé ne sont pas mises en cache. Docker et Traefik contrôlent `/healthz`. Les health checks n’analysent pas visuellement l’interface.

```bash
sudo docker ps --filter label=com.docker.compose.project=forever-healing
sudo docker logs --tail=100 forever-healing-web-1
sudo docker exec forever-healing-web-1 node scripts/healthcheck.mjs
```

Une erreur 502/503 de Traefik avec un conteneur sain invite à vérifier le réseau, la route du provider fichier, l’EntryPoint et TLS. `restart: unless-stopped` relance un processus qui quitte ; Docker ne redémarre pas automatiquement un conteneur uniquement parce qu’il est marqué `unhealthy`.

## Données persistantes et sauvegardes

Aucune base de données, aucun volume et aucun téléchargement de fichiers ne sont nécessaires. Le site n’enregistre pas de données utilisateur côté serveur.

Le code, les textes, les tooltips et les images sont intégrés à l’image Docker. Les changements de contenu se font dans `public/`, puis passent par un nouveau commit, un build et une nouvelle image. Les données de jeu restent celles datées dans le guide ; elles ne se mettent pas à jour automatiquement depuis Talents Forever.

Les sauvegardes sont explicitement différées : aucun service ni stockage de sauvegarde n’est installé. Les snapshots de configuration et références de releases sont l’état opérationnel nécessaire au rollback, pas une sauvegarde du VPS. Une reconstruction depuis le code ne récupère pas les certificats ACME ni de futures données persistantes. Conserver dans GHCR les digests requis pour le retour arrière.

## Mise à jour et rollback

Utiliser `hosting-release deploy` avec le nouveau digest. La dernière release validée et la précédente sont conservées ensemble dans un fichier d’état remplacé atomiquement, uniquement après les vérifications publiques. Chaque tentative possède son propre statut. Une tentative échouée, un timeout ou des retries répétés ne peuvent pas écraser les références validées.

Le candidat échoué peut encore tourner ; le dernier succès ne constitue pas une promesse sur le conteneur actif après échec. Le rollback est déclenché par l’opérateur :

```bash
sudo /usr/local/sbin/hosting-release rollback forever-healing
```

Après un échec/interruption, il rétablit la dernière release validée ; après une mise à jour réussie, il revient à la précédente. Les snapshots Compose/runtime/route et le digest sont restaurés, puis santé, contenu et SHA sont contrôlés par HTTPS de confiance avant promotion. Sans release validée, le retour arrière échoue clairement.

Les tests locaux des chemins succès/échec, timeout, verrouillage et rollback sont distincts du futur test réel avant trafic. Le playbook et la commande n’ont pas encore été installés sur le VPS ; aucune image n’a été publiée par ces corrections.

Aucune migration de données n’est nécessaire. Conserver aussi l’ancienne version de `compose.yml` lorsqu’une mise à jour le modifie. Un digest identifie précisément l’image à réutiliser ; un tag seul peut être remplacé. Ce déploiement à une instance peut provoquer une brève interruption lors de la recréation du conteneur.

## Références techniques

- [Image officielle Node.js](https://github.com/nodejs/docker-node)
- [Serveur HTTP Node.js](https://nodejs.org/api/http.html)
- [Publication des images avec GitHub Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [Provider fichier Traefik](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/file/)

Les attributions relatives aux données et visuels du jeu figurent dans `THIRD_PARTY_NOTICES.md` et dans le pied de page du site.
