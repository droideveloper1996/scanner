/* Prints the chat id of anyone who has messaged the bot. Send /start to the bot first. Needs TELEGRAM_BOT_TOKEN. */
import { telegramChats } from '../src/telegram.ts';
telegramChats().then(c => console.log(c.length ? JSON.stringify(c, null, 1) : 'No chats yet: send /start to the bot, then run this again.')).catch(e => { console.error((e as Error).message); process.exit(1); });
