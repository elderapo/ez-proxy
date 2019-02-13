FROM node:8.15.0

WORKDIR /src/app
COPY ./ ./

RUN rm -rf ./node_modules && yarn install

CMD ["yarn", "production-start"]