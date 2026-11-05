FROM node:26-alpine
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /manager
COPY *.mjs ./
ENV HRIS_MANAGER_DATA=/data
CMD ["node", "server.mjs"]
