# Cloner le répertoire yeti
git clone git@github.com:yeti-platform/yeti.git
Set-Location -Path .\yeti
git checkout fastapi
Set-Location -Path ..

# Cloner le répertoire yeti-feeds-frontend
git clone git@github.com:yeti-platform/yeti-feeds-frontend.git
Set-Location -Path .\yeti-feeds-frontend
git checkout fastapi
Set-Location -Path ..

# Construire et démarrer les conteneurs Docker
docker-compose build fastapi frontend
docker-compose up -d
