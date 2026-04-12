const processAndNotify = async (fixtures) => {
    await connectDB();
    const allUsers = await User.find({ "subscriptions.0": { $exists: true } });
    
    console.log(`🚀 [STARTED] Processing ${fixtures.length} fixtures at ${new Date().toLocaleTimeString()}`);

    for (const m of fixtures) {
        const fid = m.fixture.id;
        const currentScore = `${m.goals.home}-${m.goals.away}`;
        const matchStatus = m.fixture.status.short; 
        const elapsed = m.fixture.status.elapsed || 0;
        const matchName = `${m.teams.home.name} vs ${m.teams.away.name}`;

        // ၁။ Subscribe လုပ်ထားတဲ့ User တွေကို စစ်မယ်
        const subbedUsers = allUsers.filter(u => u.subscriptions.some(s => s.fixtureId === fid));

        // ၂။ Cache update (Old Data ကို ယူထားမယ်)
        const oldLive = await LiveCache.findOneAndUpdate(
            { fixtureId: fid },
            {
                home: m.teams.home.name,
                away: m.teams.away.name,
                score: currentScore,
                elapsed: elapsed,
                status: matchStatus,
                lastUpdated: new Date()
            },
            { upsert: true }
        );

        // Sub လုပ်ထားသူ မရှိရင် နောက် fixture တစ်ခုကို ကျော်သွားမယ်
        if (subbedUsers.length === 0) continue;

        console.log(`📌 [ACTIVE MATCH] ${matchName} (Status: ${matchStatus}, Score: ${currentScore})`);
        console.log(`👥 Found ${subbedUsers.length} subscribers for this match.`);

        // ၃။ Group + Topic အလိုက် Mentions စုစည်းမယ်
        const groupMap = {};
        subbedUsers.forEach(user => {
            const sub = user.subscriptions.find(s => s.fixtureId === fid);
            if (sub && sub.chatId) {
                const key = `${sub.chatId}_${sub.topicId || 0}`;
                if (!groupMap[key]) {
                    groupMap[key] = { chatId: sub.chatId, topicId: sub.topicId, mentions: [] };
                }
                const safeName = escapeMarkdown(user.name || 'User');
                const mention = user.username ? `@${user.username}` : `[${safeName}](tg://user?id=${user.userId})`;
                groupMap[key].mentions.push(mention);
            }
        });

        // --- (A) Kick Off Notification ---
        if ((!oldLive || oldLive.status === 'NS') && matchStatus === '1H') {
            console.log(`🎬 [KICK-OFF] Sending start notification for ${matchName}`);
            for (const key in groupMap) {
                const target = groupMap[key];
                const quote = KICKOFF_QUOTES[Math.floor(Math.random() * KICKOFF_QUOTES.length)];
                const mentionText = target.mentions.length > 0 ? `\n\n🎯 *${quote}*\n🔔 Noti: ${target.mentions.join(" ")}` : "";

                const msg = `🎬 *လူကြီးမင်းတို့ Noti ယူထားတဲ့ ပွဲစပြီဗျို့!*\n\n🏟️ *${m.teams.home.name}* vs *${m.teams.away.name}*\n🏆 ${m.league.name}${mentionText}`;
                await bot.api.sendMessage(target.chatId, msg, { parse_mode: "Markdown", message_thread_id: target.topicId || 0 })
                    .then(() => console.log(`✅ Kick-off sent to Group: ${target.chatId}`))
                    .catch(e => console.error(`❌ Kick-off Send Error: ${e.message}`));
            }
        }

        // --- (B) Goal Notification ---
        if (oldLive && oldLive.score !== currentScore && oldLive.score !== "null-null") {
            console.log(`⚽ [GOAL DETECTED] ${matchName} | Old: ${oldLive.score} -> New: ${currentScore}`);
            
            const lastGoalEvent = (m.events && Array.isArray(m.events)) ? m.events.filter(e => e.type === "Goal").pop() : null;
            const scorerName = lastGoalEvent?.player?.name || "ဂိုးဝင်သွားသည်";
            const isHomeGoal = currentScore.split('-')[0] > oldLive.score.split('-')[0];
            const scoringTeamLogo = isHomeGoal ? m.teams.home.logo : m.teams.away.logo;

            for (const key in groupMap) {
                const target = groupMap[key];
                const quote = GOAL_QUOTES[Math.floor(Math.random() * GOAL_QUOTES.length)];
                const mentionText = target.mentions.length > 0 ? `\n\n🎯 ${quote}\n🔔 Noti: ${target.mentions.join(" ")}` : "";

                const goalMsg = `⚽ *GOAL!!! (ဂိုးဝင်သွားပါပြီ)*\n\n🥅 *${m.teams.home.name}* ${currentScore} *${m.teams.away.name}*\n👤 Scorer: *${scorerName}*\n🕒 Time: ${matchStatus} (${elapsed}')${mentionText}`;

                try {
                    await bot.api.sendPhoto(target.chatId, scoringTeamLogo || m.teams.home.logo, { 
                        caption: goalMsg, 
                        parse_mode: "Markdown", 
                        message_thread_id: target.topicId || 0 
                    });
                    console.log(`✅ Goal Noti (Photo) sent to Group: ${target.chatId}`);
                } catch (e) {
                    console.log(`⚠️ Photo send failed, falling back to text for Group: ${target.chatId}`);
                    await bot.api.sendMessage(target.chatId, goalMsg, { 
                        parse_mode: "Markdown", 
                        message_thread_id: target.topicId || 0 
                    }).catch(e => console.error(`❌ Goal Text Send Error: ${e.message}`));
                }
            }
        }
    }
    console.log(`🏁 [FINISHED] All fixtures processed.\n`);
};


module.exports = async (req, res) => {
    try {
        await connectDB();

        if (req.method === 'POST') {
            console.log("🚀 Incoming POST Request");
            const { fixtures } = req.body;
            
            if (fixtures && Array.isArray(fixtures)) {
                // Background ထက်စာရင် await သုံးပြီး log ကို အရင်စစ်ကြည့်ပါ (Debug အတွက်)
                await processAndNotify(fixtures); 
                return res.status(200).json({ success: true, count: fixtures.length });
            }
            return res.status(400).send("Invalid fixtures data.");
        }
        
        if (req.method === 'GET') {
            console.log("🚀 Incoming GET (Cron) Request");
            const now = new Date();
            const usersWithSubs = await User.find({ "subscriptions.0": { $exists: true } });
            
            if (usersWithSubs.length === 0) {
                console.log("⚠️ No subscriptions found.");
                return res.status(200).send("Cron: No subscriptions found.");
            }

            const subFixtureIds = [...new Set(usersWithSubs.flatMap(u => u.subscriptions.map(s => s.fixtureId)))];
            const activeMatches = await Match.find({ 
                fixtureId: { $in: subFixtureIds }, 
                utcDate: { $lte: now } 
            });

            if (activeMatches.length === 0) {
                console.log("⚠️ No active subbed matches found.");
                return res.status(200).send("Cron: No active subbed matches.");
            }

            console.log("📡 Fetching from API Sports...");
            const apiRes = await fetch("https://v3.football.api-sports.io/fixtures?live=all", {
                headers: { 'x-apisports-key': APISPORTS_KEY }
            });
            const resData = await apiRes.json();

            if (resData.response && resData.response.length > 0) {
                await LiveCache.findOneAndUpdate(
                    { type: "global_sync_timer" },
                    { lastUpdated: now },
                    { upsert: true }
                );
                console.log("⏰ Global timer updated.");
                await processAndNotify(resData.response);
                return res.status(200).send("Cron sync completed.");
            }
            return res.status(200).send("No live data from API.");
        }
    } catch (err) {
        console.error("❌ Error:", err.message);
        res.status(500).send(err.message);
    }
};

