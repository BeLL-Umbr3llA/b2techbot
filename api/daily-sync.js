require('dotenv').config();
const { connectDB, Match, LiveCache,ApiLog } = require("./db"); // Path မှန်အောင် ပြန်စစ်ပါ

const APISPORTS_KEY = process.env.APISPORTS_KEY;
const TARGET_LEAGUES = [1, 2, 3, 39, 140, 135, 78, 61, 40, 88, 94, 71, 13, 848, 235];
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // .env မှာ ထည့်ပါ
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;     // .env မှာ ထည့်ပါ
const getMMDate = (offsetDays = 0) => {
    const d = new Date();
    // မြန်မာစံတော်ချိန်အတွက် Offset ညှိခြင်း
    d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 390); 
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
};

// Telegram ကို Message ပို့သည့် Function
const sendTelegramUpdate = async (message) => {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });
    } catch (err) {
        console.error("Telegram Notify Error:", err.message);
    }
};


const syncMatches = async () => {
    try {
        await connectDB();
        const today = new Date().toISOString().split('T')[0];
        
        console.log(`🧹 Cleaning up old data...`);
        const deletedMatches = await Match.deleteMany({});
        const deletedCaches = await LiveCache.deleteMany({});
        const cleanupMsg = `🗑️ Database Cleaned: Removed ${deletedMatches.deletedCount} matches.`;

        const datesToFetch = [getMMDate(0), getMMDate(1)]; 
        let totalSynced = 0;

        for (const date of datesToFetch) {
            console.log(`📡 Fetching matches for ${date}...`);
            const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}`, {
                headers: { 'x-apisports-key': APISPORTS_KEY }
            });
            const resData = await response.json();
            
            await ApiLog.findOneAndUpdate(
                { date: today },
                { $inc: { api1_count: 1 } },
                { upsert: true }
            );

            if (resData.response && resData.response.length > 0) {
                const filteredMatches = resData.response.filter(m => 
                    TARGET_LEAGUES.includes(Number(m.league.id))
                );

                if (filteredMatches.length > 0) {
                    const bulkOps = filteredMatches.map(m => ({
                        updateOne: {
                            filter: { fixtureId: Number(m.fixture.id) },
                            update: {
                                $set: {
                                    fixtureId: Number(m.fixture.id),
                                    leagueId: Number(m.league.id),
                                    leagueName: m.league.name,
                                    home: m.teams.home.name, 
                                    away: m.teams.away.name,
                                    homeLogo: m.teams.home.logo,
                                    awayLogo: m.teams.away.logo,
                                    utcDate: m.fixture.date, 
                                    status: m.fixture.status.short,
                                    lastUpdated: new Date()
                                }
                            },
                            upsert: true
                        }
                    }));

                    await Match.bulkWrite(bulkOps);
                    totalSynced += filteredMatches.length;
                }
            }
        }

         // ✅ Sync ပြီးတာနဲ့ Telegram ကို အသိပေးချက်ပို့ခြင်း
        const notifyMsg = `<b>✅ Daily Sync Success!</b>\n\n
        📅 Date: ${today}\n⚽ Matches: ${totalSynced}\n
        🗑️ Cleaned: ${cleanupMsg}`;
        await sendTelegramUpdate(notifyMsg);
        
        return { success: true, syncedCount: totalSynced, cleanupInfo: cleanupMsg };
    } catch (err) {
        console.error("❌ Sync Error:", err.message);
        return { success: false, error: err.message };
    }
};

// --- Vercel HTTP Handler ---
module.exports = async (req, res) => {
    // ✅ Security: Vercel Cron က ပို့လိုက်တဲ့ Secret ကို စစ်ဆေးခြင်း
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ status: "Error", message: "Unauthorized Request" });
    }

    const result = await syncMatches();
    if (result.success) {
        res.status(200).json({
            status: "Success",
            cleanup: result.cleanupInfo,
            new_data: `Successfully synced ${result.syncedCount} matches.`
        });
    } else {
        res.status(500).json({ status: "Error", message: result.error });
    }
};

