// ============================================================
//                 DISCORD MUSIC BOT - LAVALINK
// ============================================================
// Prefix: . (titik)
// Contoh: .play, .skip, .stop, dll
// ============================================================

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const { Manager } = require('magmastream');
const { createServer } = require('http');

// ==================== KONFIGURASI ====================
const CONFIG = {
    // Token bot Discord (dari environment variable)
    token: process.env.DISCORD_TOKEN,
    
    // Prefix command
    prefix: '.',
    
    // Lavalink server (GRATIS, tidak perlu daftar!)
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
            secure: CONFIG.lavalink.secure
        }
    ],
    send: (id, payload) => {
        const guild = client.guilds.cache.get(id);
        if (guild) guild.shard.send(payload);
    }
});

// ==================== EVENT: LAVALINK CONNECTED ====================
manager.on('nodeConnect', node => {
    console.log(`✅ [LAVALINK] Connected to "${node.options.name}"`);
});

manager.on('nodeError', (node, error) => {
    console.error(`❌ [LAVALINK] Error on "${node.options.name}":`, error.message);
});

// ==================== EVENT: LAGU MULAI DIPUTAR ====================
manager.on('trackStart', (player, track) => {
    const channel = client.channels.cache.get(player.textChannel);
    if (!channel) return;
    
    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${track.title}](${track.uri})**`)
        .setThumbnail(track.thumbnail)
        .addFields(
            { name: '⏱️ Duration', value: formatTime(track.duration), inline: true },
            { name: '🎤 Artist', value: track.author || 'Unknown', inline: true }
        )
        .setFooter({ text: `Requested by ${track.requester?.tag || 'Unknown'}` });
    
    channel.send({ embeds: [embed] });
});

// ==================== EVENT: QUEUE HABIS ====================
manager.on('queueEnd', (player) => {
    const channel = client.channels.cache.get(player.textChannel);
    if (channel) {
        channel.send('📭 **Queue selesai!** Leaving voice channel...');
    }
    player.destroy();
});

// ==================== HELPER: FORMAT WAKTU ====================
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

// ==================== HELPER: BUAT EMBED ====================
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
    // Cek user ada di voice channel
    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) {
        return message.reply({ embeds: [errorEmbed('Kamu harus masuk **voice channel** dulu!')] });
    }

    // Cek ada query
    const query = args.join(' ');
    if (!query) {
        return message.reply({ embeds: [errorEmbed('Tulis judul lagu atau URL!\nContoh: `.play never gonna give you up`')] });
    }

    // Buat atau ambil player
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

    // Connect ke voice channel
    if (player.state !== 'CONNECTED') {
        player.connect();
    }

    // Tampilkan "typing..."
    await message.channel.sendTyping();

    try {
        // Cari lagu
        const result = await manager.search(query, message.author);

        // Tidak ketemu
        if (result.loadType === 'NO_MATCHES' || result.loadType === 'LOAD_FAILED') {
            return message.reply({ embeds: [errorEmbed('Lagu tidak ditemukan!')] });
        }

        // Jika playlist
        if (result.loadType === 'PLAYLIST_LOADED') {
            for (const track of result.tracks) {
                player.queue.add(track);
            }
            message.reply({ embeds: [successEmbed(`📋 Ditambahkan **${result.tracks.length}** lagu dari playlist **${result.playlist.name}**`)] });
            
            if (!player.playing && !player.paused) {
                player.play();
            }
            return;
        }

        // Single track
        const track = result.tracks[0];
        player.queue.add(track);

        if (!player.playing && !player.paused) {
            player.play();
        } else {
            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setDescription(`✅ Ditambahkan ke queue: **[${track.title}](${track.uri})**`)
                .setThumbnail(track.thumbnail);
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
        const tracks = queue.slice(0, 10);
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
    const position = player.position;
    const duration = track.duration;

    // Progress bar
    const progress = Math.round((position / duration) * 20);
    const bar = '▬'.repeat(progress) + '🔘' + '▬'.repeat(20 - progress);

    const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${track.title}](${track.uri})**\n\n${bar}\n\`${formatTime(position)} / ${formatTime(duration)}\``)
        .setThumbnail(track.thumbnail)
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

    // Jika tidak ada argument, tampilkan volume saat ini
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

    // Toggle: off → song → queue → off
    if (!player.trackRepeat && !player.queueRepeat) {
        player.setTrackRepeat(true);
        message.reply({ embeds: [successEmbed('🔂 Loop: **Lagu ini** (repeat 1 lagu)')] });
    } else if (player.trackRepeat) {
        player.setTrackRepeat(false);
        player.setQueueRepeat(true);
        message.reply({ embeds: [successEmbed('🔁 Loop: **Queue** (repeat semua)')] });
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

// ==================== DAFTAR COMMAND & ALIAS ====================
const commands = {
    'play': cmdPlay,
    'p': cmdPlay,
    
    'skip': cmdSkip,
    's': cmdSkip,
    
    'stop': cmdStop,
    'leave': cmdStop,
    'dc': cmdStop,
    'disconnect': cmdStop,
    
    'pause': cmdPause,
    'resume': cmdResume,
    
    'queue': cmdQueue,
    'q': cmdQueue,
    
    'nowplaying': cmdNowPlaying,
    'np': cmdNowPlaying,
    
    'volume': cmdVolume,
    'vol': cmdVolume,
    
    'loop': cmdLoop,
    'repeat': cmdLoop,
    
    'shuffle': cmdShuffle,
    
    'help': cmdHelp,
    'h': cmdHelp
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

    // Set status bot
    client.user.setActivity(`${CONFIG.prefix}help | 🎵`, { type: ActivityType.Listening });

    // Init Lavalink
    manager.init(client.user.id);
});

// ==================== EVENT: VOICE STATE UPDATE ====================
client.on('raw', (d) => manager.updateVoiceState(d));

// ==================== EVENT: MESSAGE ====================
client.on('messageCreate', async (message) => {
    // Ignore bot
    if (message.author.bot) return;
    
    // Cek prefix
    if (!message.content.startsWith(CONFIG.prefix)) return;

    // Parse command
    const args = message.content.slice(CONFIG.prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    // Jalankan command
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

// ==================== HEALTH CHECK SERVER (untuk Render) ====================
const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'online',
        bot: client.user?.tag || 'Starting...',
        servers: client.guilds?.cache.size || 0,
        uptime: process.uptime()
    }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
});

// ==================== START BOT ====================
if (!CONFIG.token) {
    console.error('');
    console.error('❌ ERROR: DISCORD_TOKEN tidak ditemukan!');
    console.error('   Pastikan sudah set di Environment Variables');
    console.error('');
    process.exit(1);
}

client.login(CONFIG.token);
