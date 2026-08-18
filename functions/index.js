const { onDocumentCreated } = require("firebase-functions/v2/firestore");

exports.notifyNewMessage = onDocumentCreated("messages/{docId}", async (event) => {
    const data = event.data.data();
    const text = (data.text || "").slice(0, 300);

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        console.error("Telegram token/chat_id not configured.");
        return;
    }

    const message = `New post on 404-nnf:\n\n${text}`;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message }),
    });
});