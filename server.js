'use strict';

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const line = require('@line/bot-sdk');
const line_pay = require("line-pay");
const uuid = require("uuid/v4");
const moment = require("moment");
const PORT = process.env.PORT || 5000;
const admin = process.env.ADMIN;

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
const client = new line.Client(config);

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

app.get("/pay/refund", (req, res) => {
    console.log(req.query);
    if(req.query.userId !== process.env.ADMIN) {
        return res.status(500).end();
    } else {
        axios({
            method: 'get',
            url: process.env.KINTONE_DOMEINNAME + '/k/v1/records.json',
            headers: {
                'X-Cybozu-API-Token': process.env.KINTONE_PAY_APIKEY,
                'Content-Type': 'application/json',
            },
            data: {
                app: process.env.KINTONE_PAY_APPID,
                query: `lockId in ("${req.query.lockId}")`
            }
        })
        .then((result) => {
            const refundAmount = 1
            const options = {
                transactionId: result.data.records[0].transactionId.value,
                refundAmount: refundAmount
            }
            return pay.refund(options).then((response) => {
                console.log(response);
                res.sendStatus(200);
                axios({
                    method: 'put',
                    url: process.env.KINTONE_DOMEINNAME + '/k/v1/record.json',
                    headers: {
                        'X-Cybozu-API-Token': process.env.KINTONE_PARK_APIKEY,
                        'Content-Type': 'application/json',
                    },
                    data: {
                        app: parseInt(process.env.KINTONE_PARK_APPID),
                        id: req.query.lockId,
                        record: {
                            state: {value: 2},
                            return_time: {value: moment().format("YYYY-MM-DDThh:mm:ss") + "Z"}
                        }
                    }
                })
                .then((res) => {
                    return client.pushMessage(result.data.records[0].userId.value, {
                        type: 'text',
                        text: `${refundAmount}円返却しました`
                    });
                })
                .catch((err) => {
                    console.log(err);
                    return res.status(500).send("Update parking data was failed.")
                })
            })
        })
        .catch((err) => {
            console.log(err);
            return res.status(500).send("Fetch transaction data was failed.")
        })
    }
})

app.get("/pay/confirm", async(req, res) => {
    if (!req.query.transactionId){
        console.log("Transaction Id not found.");
        return res.status(400).send("Transaction Id not found.");
    }

    const obj = {
        app: process.env.KINTONE_PAY_APPID,
        query: `transactionId in ("${req.query.transactionId}")`
    }
    // Retrieve the reservation from database.
    const response = await axios({
        method: 'get',
        url: process.env.KINTONE_DOMEINNAME + '/k/v1/records.json',
        headers: {
            'X-Cybozu-API-Token': process.env.KINTONE_PAY_APIKEY,
            'Content-Type': 'application/json',
        },
        data: obj
    })

    if (response.data.records.length === 0){
        console.log("Reservation not found.");
        return res.status(400).send("Reservation not found.")
    }

    const record = response.data.records[0];

    console.log(`Retrieved following reservation.`);
    console.log(record);

    let confirmation = {
        transactionId: req.query.transactionId,
        amount: parseInt(record.amount.value),
        currency: "JPY"
    }

    console.log(`Going to confirm payment with following options.`);
    console.log(confirmation);
    // Capture payment.
    return pay.confirm(confirmation).then((response) => {

        res.sendStatus(200);

        axios({
            method: 'put',
            url: process.env.KINTONE_DOMEINNAME + '/k/v1/record.json',
            headers: {
                'X-Cybozu-API-Token': process.env.KINTONE_PARK_APIKEY,
                'Content-Type': 'application/json',
            },
            data: {
                app: parseInt(process.env.KINTONE_PARK_APPID),
                id: record.lockId.value,
                record: {
                    userId: {value: record.userId.value},
                    state: {value: 1},
                    pay_time: {value: moment().format("YYYY-MM-DDThh:mm:ss") + "Z"}
                }
            }
        })
        .then((result) => {
            console.log(result.data);
            let messages = [{
                type: "sticker",
                packageId: 2,
                stickerId: 144
            },{
                type: "text",
                text: "決済が完了しました。"
            }]
            return client.pushMessage(record.userId.value, messages);
        })
        .catch((err) => {
            res.status(500).send("Updating data was failed.")
            console.log(err);
        })

    });
})

function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
      return Promise.resolve(null);
    }

    if(event.source.userId === admin) {
        handleRefund(event);
    } else {
        handlePayment(event);
    }

}

function handleRefund(event) {
    if (isNumber(event.message.text) === true) {
        axios({
            method: 'get',
            url: process.env.KINTONE_DOMEINNAME + '/k/v1/record.json',
            headers: {
                'X-Cybozu-API-Token': process.env.KINTONE_PARK_APIKEY,
                'Content-Type': 'application/json',
            },
            data: {
                app: process.env.KINTONE_PARK_APPID,
                id: event.message.text
            }
        })
        .then((res) => {
            let message = {
                type: "template",
                altText: `lockId【${event.message.text}】の鍵が返却されましたか？`,
                template: {
                    type: "buttons",
                    text: `lockId【${event.message.text}】の鍵が返却されましたか？`,
                    actions: [
                        {type: "uri", label: "はい", uri: process.env.OWN_DOMEIN + `/pay/refund?lockId=${event.message.text}&userId=${event.source.userId}`}
                    ]
                }
            }
            return client.replyMessage(event.replyToken, message);
        })
        .catch((err) => {
            console.log(err);
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'こちらのlockIdは無効です'
            });
        })
    } else {
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'LockIdを入力してください'
        });
    }
}

function handlePayment(event) {
    if (isNumber(event.message.text) === true) {
        let options = {
            productName: "罰金",
            amount: 1,
            currency: "JPY",
            orderId: uuid(),
            confirmUrl: process.env.LINE_PAY_CONFIRM_URL,
            confirmUrlType: "SERVER"
        }
    
        pay.reserve(options).then(async(response) => {
            let reservation = options;
            reservation.transactionId = response.info.transactionId;
            reservation.userId = event.source.userId;
    
            console.log(`Reservation was made. Detail is following.`);
            console.log(reservation);

            try {
                const res = await axios({
                    method: 'get',
                    url: process.env.KINTONE_DOMEINNAME + '/k/v1/record.json',
                    headers: {
                        'X-Cybozu-API-Token': process.env.KINTONE_PARK_APIKEY,
                        'Content-Type': 'application/json',
                    },
                    data: {
                        app: process.env.KINTONE_PARK_APPID,
                        id: event.message.text
                    }
                })

                if(res.data.record) {
                    console.log("hogehoge")
                    axios({
                        method: 'post',
                        url: process.env.KINTONE_DOMEINNAME + '/k/v1/record.json',
                        headers: {
                           'X-Cybozu-API-Token': process.env.KINTONE_PAY_APIKEY,
                           'Content-Type': 'application/json',
                        },
                        data: {
                            app: parseInt(process.env.KINTONE_PAY_APPID),
                            record: {
                                userId: {value: reservation.userId},
                                transactionId: {value: reservation.transactionId},
                                lockId: {value: parseInt(event.message.text)},
                                amount: {value: reservation.amount},
                                orderId: {value: reservation.orderId},
                                confirmUrl: {value: reservation.confirmUrl}
                            }
                        }
                    })
                    .then((res) => {
                        console.log(res.data);
                     })
                     .catch((err) => {
                        console.log(err);
                        Promise.resolve(null)
                     })
                }
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
            } catch(err) {
                console.log(err);
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'こちらのlockIdは無効です'
                });
            }
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