# Cloner le répertoire yeti
git clone https://github.com/yeti-platform/yeti.git
# Copier le fichier de configuration
Copy-Item -Path "yeti/yeti.conf.sample" -Destination "yeti/yeti.conf"

# Cloner le répertoire yeti-feeds-frontend
git clone https://github.com/yeti-platform/yeti-feeds-frontend.git



# Construire et démarrer les conteneurs Docker
docker compose up -d
