'use strict';

require('dotenv').config();

const express = require('express');
const line = require('@line/bot-sdk');
const PORT = process.env.PORT || 3000;

const config = {
    channelSecret: process.env.CHANNEL_SECRET,
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};

const app = express();

app.post('/webhook', line.middleware(config), (req, res) => {
    console.log(req.body.events);

    Promise
      .all(req.body.events.map(handleEvent))
      .then((result) => res.json(result))
      .catch((err) => {
        console.error(err);
        res.status(500).end();
      });
});

const client = new line.Client(config);
function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
      return Promise.resolve(null);
    }

    if (isNumber(event.message.text) === true) {
        let message = {
            type: "template",
            altText: `下記のボタンで決済に進んでください`,
            template: {
                type: "buttons",
                text: `下記のボタンで決済に進んでください`,
                actions: [
                    {type: "uri", label: "LINE Payで決済", uri: "https://acompany.tech"},
                ]
            }
        }
        return client.replyMessage(event.replyToken, message);
    } else {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'LockIdを入力してください' 
        });
    }
}

function isNumber(inputValue) {
    const pattern = /^\d*$/
    return pattern.test(inputValue);
}
  
app.listen(PORT);
console.log(`Server running at ${PORT}`);