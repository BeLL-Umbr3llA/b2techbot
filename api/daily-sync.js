require('dotenv').config();
const { connectDB, Match, LiveCache,ApiLog,Standing } = require("../db"); // Path မှန်အောင် ပြန်စစ်ပါ

const APISPORTS_KEY = process.env.APISPORTS_KEY;
const TARGET_LEAGUES = [1, 2, 3, 39, 140, 135, 78, 61, 40, 88, 94, 71, 13, 848, 235];
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN; // .env မှာ ထည့်ပါ
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;     // .env မှာ ထည့်ပါ
const ORG_LEAGUES = ['PL', 'ELC', 'FL1', 'SA', 'PPL', 'PD', 'CL', 'EC', 'WC'];
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;

// Telegram ကို Message ပို့သည့် Function
const sendTelegramUpdate = async (message) => {
    try {
        console.log(`📡 going to chat id telegram`);
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
        
        console.log(`🧹 Cleaning up old data...`);
        const deletedMatches = await Match.deleteMany({});
        const deletedCaches = await LiveCache.deleteMany({});
        const cleanupMsg = `🗑️ Database Cleaned: ${deletedMatches.deletedCount} matches.`;

         // --- UTC ရက်စွဲ ထုတ်ယူခြင်း ---
        const now = new Date();
        
        // ဒီနေ့ UTC ရက်စွဲ (YYYY-MM-DD)
        const todayUTC = now.toISOString().split('T')[0];
        
        // မနက်ဖြန် UTC ရက်စွဲ (YYYY-MM-DD)
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(now.getUTCDate() + 1);
        const tomorrowUTC = tomorrow.toISOString().split('T')[0];

        console.log(`📡 Fetching UTC Dates: ${todayUTC} and ${tomorrowUTC}`);

        // ၁၃ ရက်နဲ့ ၁၄ ရက် (UTC အတိုင်း) Fetch လုပ်မည့်စာရင်း
        const datesToFetch = [todayUTC, tomorrowUTC]; 
        let totalSynced = 0;

        for (const date of datesToFetch) {
            console.log(`📡 Fetching matches for ${date}...`);
            const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}`, {
                headers: { 'x-apisports-key': APISPORTS_KEY }
            });
            const resData = await response.json();
            
            await ApiLog.findOneAndUpdate(
                { date: todayUTC },
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

        console.log("🏆 Syncing 12 Top League Tables...");
            let tablesUpdated = 0;

        for (const code of ORG_LEAGUES) {
            try {
                const resG = await fetch(`https://api.football-data.org/v4/competitions/${code}/standings`, {
                    headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY }
                });
                const resDataG = await resG.json();

                if (resG.status === 200 && resDataG.standings?.length > 0) {
                    await Standing.findOneAndUpdate(
                        { leagueId: resDataG.competition.id },
                        { $set: {
                            leagueId: resDataG.competition.id,
                            leagueName: resDataG.competition.name,
                            season: resDataG.filters.season,
                            table: resDataG.standings[0].table,
                            lastUpdated: new Date()
                        }},
                        { upsert: true }
                    );
                    tablesUpdated++;
                    // loop ထဲမှာ ဒီလိုပြင်လိုက်ပါ
                console.log(`✅ [${tablesUpdated}/${ORG_LEAGUES.length}] Updated Table: ${resDataG.competition.name}`);
                }
              
            } catch (err) {
                console.error(`❌ Standing Error (${code}):`, err.message);
            }
        }
    
        console.log(`📡 going to telegram`);

         // ✅ Sync ပြီးတာနဲ့ Telegram ကို အသိပေးချက်ပို့ခြင်း
        const notifyMsg = '<b>✅ Daily Sync Success!</b>\n\n' +
                          '📅 Date: ' + todayUTC + '\n' +
                          '📅 Date: ' + tomorrowUTC + '\n'+
                          cleanupMsg + '\n' +
                          '♻️ SyncMatches: ' + totalSynced + '\n'+
                          '🏆 Tables: ' + tablesUpdated + ' leagues updated.';

        await sendTelegramUpdate(notifyMsg);
        console.log(`📡after going to telegram`);
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

