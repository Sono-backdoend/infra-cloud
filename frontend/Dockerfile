# Etapa 1: Construção da aplicação
FROM node:18-alpine AS build

# Definindo o diretório de trabalho dentro do container
WORKDIR /app

# Copiando o package.json e o package-lock.json para instalar as dependências
COPY package*.json ./

# A rede do Docker Desktop (WSL2) às vezes derruba downloads grandes no meio
# (ECONNRESET), o que também pode disparar o bug do npm "Exit handler never
# called!" e deixar a instalação incompleta mesmo retornando sucesso.
# Configura retries mais agressivos para tolerar isso.
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000

# Instalando as dependências do projeto
# Em redes instáveis (comum no Docker Desktop + WSL2), o npm pode sofrer do bug
# "Exit handler never called!" e terminar com exit code 0 mesmo com a instalação
# incompleta (ex: react-scripts ausente em node_modules/.bin). Por isso validamos
# a instalação e tentamos novamente do zero se ela ficou corrompida.
RUN for i in 1 2 3; do \
      npm install --no-audit --no-fund && test -x node_modules/.bin/react-scripts && break; \
      echo "npm install incompleto (tentativa $i/3), limpando e tentando novamente..."; \
      rm -rf node_modules; \
    done \
    && test -x node_modules/.bin/react-scripts

# Copiando todo o conteúdo da pasta do projeto para o container
COPY . .

# react-scripts build sempre roda com NODE_ENV=production, então sempre lê o
# .env.production. Quando REACT_APP_BACKEND_URL é passado como build arg
# (ex: docker-compose local), ele sobrescreve o valor do .env.production;
# se não for passado, o build segue usando o .env.production normalmente
# (ex: deploy real servido por este mesmo Dockerfile).
ARG REACT_APP_BACKEND_URL

# Construindo a aplicação para produção
RUN if [ -n "$REACT_APP_BACKEND_URL" ]; then \
      REACT_APP_BACKEND_URL="$REACT_APP_BACKEND_URL" npm run build; \
    else \
      npm run build; \
    fi

# Etapa 2: Servindo a aplicação
FROM nginx:alpine

# Copiando o build da etapa anterior para o diretório padrão do Nginx
COPY --from=build /app/build /usr/share/nginx/html

# Expondo a porta 80 para acesso à aplicação
EXPOSE 80

# Comando para iniciar o Nginx e servir a aplicação
CMD ["nginx", "-g", "daemon off;"]
