// ============================================================
//                 DISCORD MUSIC BOT - LAVALINK
// ============================================================

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const { Manager } = require('magmastream');
const { createServer } = require('http');

// ==================== KONFIGURASI ====================
const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    prefix: '.',
    lavalink: {
        host: process.env.LAVALINK_HOST || 'lava-v3.ajieblogs.eu.org',
        port: parseInt(process.env.LAVALINK_PORT) || 80,
        password: process.env.LAVALINK_PASSWORD || 'https://dsc.gg/ajidevserver',
        secure: process.env.LAVALINK_SECURE === 'true'
    }
};

// ==================== BUAT CLIENT DISCORD ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

// ==================== BUAT LAVALINK MANAGER ====================
const manager = new Manager({
    nodes: [
        {
            name: 'Main',
            host: CONFIG.lavalink.host,
            port: CONFIG.lavalink.port,
            password: CONFIG.lavalink.password,
            secure: CONFIG.lavalink.secure,
            retryAmount: 5,
            retryDelay: 3000
        }
    ],
    send: (id, payload) => {
        const guild = client.guilds.cache.get(id);
        if (guild) guild.shard.send(payload);
    },
    autoPlay: true,
    playNextOnEnd: true,
    defaultSearchPlatform: 'ytsearch',  // ✅ FIXED: 'youtube' → 'ytsearch'
    restTimeout: 60000
});

// ==================== EVENT: LAVALINK ====================
manager.on('nodeConnect', node => {
    console.log(`✅ [LAVALINK] Connected to "${node.options.name}"`);
});

manager.on('nodeError', (node, error) => {
    console.error(`❌ [LAVALINK] Error on "${node.options.name}":`, error.message);
});

manager.on('nodeDisconnect', (node) => {
    console.log(`⚠️ [LAVALINK] Node "${node.options.name}" disconnected`);
});

// ==================== EVENT: LAGU MULAI DIPUTAR ====================
manager.on('trackStart', (player, track) => {
    const channel = client.channels.cache.get(player.textChannel);
    if (!channel) return;
    
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${track.title}](${track.uri})**`)
        .setThumbnail(track.thumbnail || null)
        .addFields(
            { name: '⏱️ Duration', value: formatTime(track.duration), inline: true },
            { name: '🎤 Artist', value: track.author || 'Unknown', inline: true }
        )
        .setFooter({ text: `Requested by ${track.requester?.tag || 'Unknown'}` });
    
    channel.send({ embeds: [embed] }).catch(() => {});
});

// ==================== EVENT: QUEUE HABIS ====================
manager.on('queueEnd', (player) => {
    const channel = client.channels.cache.get(player.textChannel);
    if (channel) {
        channel.send('📭 **Queue selesai!** Leaving voice channel...').catch(() => {});
    }
    setTimeout(() => {
        if (player) player.destroy();
    }, 1000);
});

// ==================== HELPER FUNCTIONS ====================
function formatTime(ms) {
    if (!ms) return '0:00';
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / 1000 / 60) % 60);
    const hours = Math.floor(ms / 1000 / 60 / 60);
    
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function createEmbed(description, color = 0x5865F2) {
    return new EmbedBuilder().setColor(color).setDescription(description);
}

function successEmbed(msg) {
    return createEmbed(`✅ ${msg}`, 0x57F287);
}

function errorEmbed(msg) {
    return createEmbed(`❌ ${msg}`, 0xED4245);
}

// ==================== COMMANDS ====================

// .play <judul/url>
async function cmdPlay(message, args) {
    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) {
        return message.reply({ embeds: [errorEmbed('Kamu harus masuk **voice channel** dulu!')] });
    }

    const query = args.join(' ');
    if (!query) {
        return message.reply({ embeds: [errorEmbed('Tulis judul lagu atau URL!\nContoh: `.play never gonna give you up`')] });
    }

    let player = manager.players.get(message.guild.id);
    if (!player) {
        player = manager.create({
            guild: message.guild.id,
            voiceChannel: voiceChannel.id,
            textChannel: message.channel.id,
            selfDeafen: true,
            volume: 80
        });
    }

    if (player.state !== 'CONNECTED') {
        player.connect();
    }

    await message.channel.sendTyping();

    try {
        const result = await manager.search(query, message.author);

        if (result.loadType === 'NO_MATCHES' || result.loadType === 'LOAD_FAILED' || result.loadType === 'error' || result.loadType === 'empty') {
            return message.reply({ embeds: [errorEmbed('Lagu tidak ditemukan!')] });
        }

        if (result.loadType === 'PLAYLIST_LOADED' || result.loadType === 'playlist') {
            const tracks = result.tracks || result.playlist?.tracks || [];
            for (const track of tracks) {
                player.queue.add(track);
            }
            message.reply({ embeds: [successEmbed(`📋 Ditambahkan **${tracks.length}** lagu dari playlist!`)] });
            
            if (!player.playing && !player.paused) {
                player.play();
            }
            return;
        }

        const track = result.tracks[0];
        player.queue.add(track);

        if (!player.playing && !player.paused) {
            player.play();
        } else {
            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setDescription(`✅ Ditambahkan ke queue: **[${track.title}](${track.uri})**`)
                .setThumbnail(track.thumbnail || null);
            message.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Play error:', error);
        message.reply({ embeds: [errorEmbed('Gagal memutar lagu! Coba lagi.')] });
    }
}

// .skip
async function cmdSkip(message) {
    const player = manager.players.get(message.guild.id);
    if (!player || !player.queue.current) {
        return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar!')] });
    }

    const skipped = player.queue.current.title;
    player.stop();
    message.reply({ embeds: [successEmbed(`⏭️ Skipped: **${skipped}**`)] });
}

// .stop
async function cmdStop(message) {
    const player = manager.players.get(message.guild.id);
    if (!player) {
        return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar!')] });
    }

    player.destroy();
    message.reply({ embeds: [successEmbed('⏹️ Musik dihentikan! Bye bye~ 👋')] });
}

// .pause
async function cmdPause(message) {
    const player = manager.players.get(message.guild.id);
    if (!player || !player.queue.current) {
        return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar!')] });
    }

    if (player.paused) {
        return message.reply({ embeds: [errorEmbed('Musik sudah di-pause!')] });
    }

    player.pause(true);
    message.reply({ embeds: [successEmbed('⏸️ Paused!')] });
}

// .resume
async function cmdResume(message) {
    const player = manager.players.get(message.guild.id);
    if (!player || !player.queue.current) {
        return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar!')] });
    }

    if (!player.paused) {
        return message.reply({ embeds: [errorEmbed('Musik tidak sedang di-pause!')] });
    }

    player.pause(false);
    message.reply({ embeds: [successEmbed('▶️ Resumed!')] });
}

// .queue
async function cmdQueue(message) {
    const player = manager.players.get(message.guild.id);
    if (!player || !player.queue.current) {
        return message.reply({ embeds: [errorEmbed('Queue kosong!')] });
    }

    const current = player.queue.current;
    const queue = player.queue;

    let desc = `**🎵 Sedang Diputar:**\n[${current.title}](${current.uri}) - \`${formatTime(current.duration)}\`\n\n`;

    if (queue.length > 0) {
        desc += '**📋 Antrian:**\n';
        const tracks = [...queue].slice(0, 10);
        tracks.forEach((track, i) => {
            desc += `\`${i + 1}.\` [${track.title}](${track.uri}) - \`${formatTime(track.duration)}\`\n`;
        });
        
        if (queue.length > 10) {
            desc += `\n*...dan ${queue.length - 10} lagu lainnya*`;
        }
    }

    desc += `\n\n**Total:** ${queue.length + 1} lagu`;

    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎶 Music Queue')
        .setDescription(desc);

    message.reply({ embeds: [embed] });
}

// .nowplaying / .np
async function cmdNowPlaying(message) {
    const player = manager.players.get(message.guild.id);
    if (!player || !player.queue.current) {
        return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar!')] });
    }

    const track = player.queue.current;
    const position = player.position || 0;
    const duration = track.duration || 0;

    const progress = duration > 0 ? Math.round((position / duration) * 20) : 0;
    const bar = '▬'.repeat(Math.min(progress, 20)) + '🔘' + '▬'.repeat(Math.max(20 - progress, 0));

    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${track.title}](${track.uri})**\n\n${bar}\n\`${formatTime(position)} / ${formatTime(duration)}\``)
        .setThumbnail(track.thumbnail || null)
        .addFields({ name: '🎤 Artist', value: track.author || 'Unknown', inline: true })
        .setFooter({ text: `Requested by ${track.requester?.tag || 'Unknown'}` });

    message.reply({ embeds: [embed] });
}

// .volume <0-100>
async function cmdVolume(message, args) {
    const player = manager.players.get(message.guild.id);
    if (!player) {
        return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar!')] });
    }

    if (!args[0]) {
        return message.reply({ embeds: [successEmbed(`🔊 Volume saat ini: **${player.volume}%**`)] });
    }

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 100) {
        return message.reply({ embeds: [errorEmbed('Volume harus antara **0-100**!')] });
    }

    player.setVolume(vol);
    message.reply({ embeds: [successEmbed(`🔊 Volume diubah ke **${vol}%**`)] });
}

// .loop
async function cmdLoop(message) {
    const player = manager.players.get(message.guild.id);
    if (!player) {
        return message.reply({ embeds: [errorEmbed('Tidak ada lagu yang diputar!')] });
    }

    if (!player.trackRepeat && !player.queueRepeat) {
        player.setTrackRepeat(true);
        message.reply({ embeds: [successEmbed('🔂 Loop: **Lagu ini**')] });
    } else if (player.trackRepeat) {
        player.setTrackRepeat(false);
        player.setQueueRepeat(true);
        message.reply({ embeds: [successEmbed('🔁 Loop: **Queue**')] });
    } else {
        player.setQueueRepeat(false);
        message.reply({ embeds: [successEmbed('➡️ Loop: **Off**')] });
    }
}

// .shuffle
async function cmdShuffle(message) {
    const player = manager.players.get(message.guild.id);
    if (!player || player.queue.length < 2) {
        return message.reply({ embeds: [errorEmbed('Queue harus punya minimal **2 lagu**!')] });
    }

    player.queue.shuffle();
    message.reply({ embeds: [successEmbed(`🔀 Queue diacak! (${player.queue.length} lagu)`)] });
}

// .help
async function cmdHelp(message) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎵 Music Bot - Commands')
        .setDescription('Prefix: `.` (titik)')
        .addFields(
            {
                name: '🎶 Putar Musik',
                value: '`.play <judul/url>` - Putar lagu\n`.skip` - Skip lagu\n`.stop` - Stop & leave',
                inline: false
            },
            {
                name: '⏯️ Kontrol',
                value: '`.pause` - Pause\n`.resume` - Resume\n`.volume <0-100>` - Atur volume',
                inline: false
            },
            {
                name: '📋 Queue',
                value: '`.queue` - Lihat antrian\n`.np` - Lagu sekarang\n`.loop` - Loop mode\n`.shuffle` - Acak antrian',
                inline: false
            }
        )
        .setFooter({ text: '🎵 Powered by Lavalink' });

    message.reply({ embeds: [embed] });
}

// ==================== DAFTAR COMMAND ====================
const commands = {
    'play': cmdPlay, 'p': cmdPlay,
    'skip': cmdSkip, 's': cmdSkip,
    'stop': cmdStop, 'leave': cmdStop, 'dc': cmdStop, 'disconnect': cmdStop,
    'pause': cmdPause,
    'resume': cmdResume,
    'queue': cmdQueue, 'q': cmdQueue,
    'nowplaying': cmdNowPlaying, 'np': cmdNowPlaying,
    'volume': cmdVolume, 'vol': cmdVolume,
    'loop': cmdLoop, 'repeat': cmdLoop,
    'shuffle': cmdShuffle,
    'help': cmdHelp, 'h': cmdHelp
};

// ==================== EVENT: BOT READY ====================
client.once('ready', () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║       🎵 DISCORD MUSIC BOT 🎵          ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  Bot: ${client.user.tag.padEnd(31)}║`);
    console.log(`║  Servers: ${String(client.guilds.cache.size).padEnd(28)}║`);
    console.log(`║  Prefix: ${CONFIG.prefix.padEnd(29)}║`);
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    client.user.setActivity(`${CONFIG.prefix}help | 🎵`, { type: ActivityType.Listening });
    manager.init(client.user.id);
});

// ==================== EVENT: VOICE STATE ====================
client.on('raw', (d) => manager.updateVoiceState(d));

// ==================== EVENT: MESSAGE ====================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(CONFIG.prefix)) return;

    const args = message.content.slice(CONFIG.prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    const command = commands[cmd];
    if (command) {
        try {
            await command(message, args);
        } catch (error) {
            console.error('Command error:', error);
            message.reply({ embeds: [errorEmbed('Terjadi error!')] });
        }
    }
});

// ==================== HEALTH CHECK SERVER ====================
const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'online',
        bot: client.user?.tag || 'Starting...',
        servers: client.guilds?.cache.size || 0
    }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
});

// ==================== START BOT ====================
if (!CONFIG.token) {
    console.error('❌ ERROR: DISCORD_TOKEN tidak ditemukan!');
    process.exit(1);
}

client.login(CONFIG.token);
