'use strict';

require('dotenv').config();

const express = require('express');
const line = require('@line/bot-sdk');
const line_pay = require("line-pay");
const cache = require("memory-cache");
const uuid = require("uuid/v4");
const PORT = process.env.PORT || 5000;

const config = {
    channelSecret: process.env.CHANNEL_SECRET,
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};

const pay = new line_pay({
    channelId: process.env.LINE_PAY_CHANNEL_ID,
    channelSecret: process.env.LINE_PAY_CHANNEL_SECRET,
    isSandbox: true
})

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

app.get("/pay/confirm", (req, res) => {
    if (!req.query.transactionId){
        console.log("Transaction Id not found.");
        return res.status(400).send("Transaction Id not found.");
    }

    // Retrieve the reservation from database.
    let reservation = cache.get(req.query.transactionId);
    if (!reservation){
        console.log("Reservation not found.");
        return res.status(400).send("Reservation not found.")
    }

    console.log(`Retrieved following reservation.`);
    console.log(reservation);

    let confirmation = {
        transactionId: req.query.transactionId,
        amount: reservation.amount,
        currency: reservation.currency
    }

    console.log(`Going to confirm payment with following options.`);
    console.log(confirmation);

    // Capture payment.
    return pay.confirm(confirmation).then((response) => {
        res.sendStatus(200);

        // Reply to user that payment has been completed.
        let messages = [{
            type: "sticker",
            packageId: 2,
            stickerId: 144
        },{
            type: "text",
            text: "罰金の決済が完了しました。"
        }]
        return client.pushMessage(reservation.userId, messages);
    });
})

const client = new line.Client(config);
function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
      return Promise.resolve(null);
    }

    if (isNumber(event.message.text) === true) {
        let options = {
            productName: "罰金",
            amount: 1,
            currency: "JPY",
            orderId: uuid(),
            confirmUrl: process.env.LINE_PAY_CONFIRM_URL,
            confirmUrlType: "SERVER"
        }
    
        pay.reserve(options).then((response) => {
            let reservation = options;
            reservation.transactionId = response.info.transactionId;
            reservation.userId = event.source.userId;
    
            console.log(`Reservation was made. Detail is following.`);
            console.log(reservation);
    
            cache.put(reservation.transactionId, reservation);
    
            let message = {
                type: "template",
                altText: `下記のボタンで決済に進んでください`,
                template: {
                    type: "buttons",
                    text: `下記のボタンで決済に進んでください`,
                    actions: [
                        {type: "uri", label: "LINE Payで決済", uri: response.info.paymentUrl.web},
                    ]
                }
            }
            return client.replyMessage(event.replyToken, message);
        })
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