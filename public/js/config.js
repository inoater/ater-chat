/* =====================================================================
   ATER LIVE — CONFIG
   Everything about the streamer lives here. Change it and reload.
   ===================================================================== */
const CONFIG={
  name:'Inoater',
  /* channels used for the Big Screen default, live status and chat auto-connect */
  channels:{twitch:'inoater',kick:'inoater',youtube:''},
  /* your names in chat: mentioning any of these lands in Mentions */
  aliases:['inoater','ino'],
  /* Ater chat server (ater-server.js). '' = the same address this page is served from */
  server:'',
  /* Twitch user ID whose 7TV emote set Ater chatters can use (optional, numbers only) */
  sevenTV:'',
  /* Kick relay (see kick-relay.js). Leave '' to type it into the Kick tab instead */
  kickRelay:'',
  /* fetch live status / viewers / uptime (Kick API + decapi.me for Twitch). Best effort. */
  liveStatus:true,
  links:{
    twitch:'https://www.twitch.tv/inoater',kick:'https://kick.com/inoater',youtube:'https://www.youtube.com/@inoater',
    x:'https://x.com/inoater',discord:'#',
    subscribe:'https://www.twitch.tv/subs/inoater',donate:'#',store:'#'
  },
  /* weekly schedule, written in UTC (day: 0=Sun … 6=Sat). Each viewer sees it in their own time. */
  week:[
    {day:1,utc:'23:00',hours:4,what:'Main stream',tag:'Just chatting'},
    {day:2,utc:'23:00',hours:4,what:'Main stream',tag:'Debates'},
    {day:3,utc:'23:00',hours:4,what:'Main stream',tag:'Games'},
    {day:4,utc:'23:00',hours:5,what:'Main stream',tag:'News & takes'},
    {day:5,utc:'21:00',hours:3,what:'Chat decides',tag:'Community'},
    {day:6,utc:'18:00',hours:6,what:'Long Saturday',tag:'Marathon'}
  ],
  events:[
    {title:'Inoater vs. Rowan Vale: Live Debate Night',start:'2026-11-12T00:00:00Z',hours:2,where:'The Standard Hall, Austin TX',tags:['Livestreamed','In person'],text:'Two hours, one stage, zero notes. Doors at 6, debate at 7, audience questions after.',cta:'Get tickets',url:'#'},
    {title:'Charity Marathon Meetup',start:'2026-11-21T20:00:00Z',hours:4,where:'Riverside Park, Portland OR',tags:['Event'],text:'Community 5k, then a meet and greet. Everything raised goes to this quarter\u2019s charity.',cta:'RSVP',url:'#'},
    {title:'Q&A: Two Years of Streaming',start:'2026-12-05T01:00:00Z',hours:3,where:'Online \u00b7 Big Screen',tags:['Livestreamed'],text:'Anniversary stream. Send questions early, chat picks the format on the day.',cta:'Remind me',url:'#'}
  ],
  videos:{
    uploads:[
      ['The Take Nobody Asked For','2026-11-03','18:42'],['3 Hours of Chaos (Highlights)','2026-11-02','24:10'],['Reacting to My Old Videos','2026-11-01','31:05'],
      ['Why Everyone\u2019s Wrong About This','2026-10-30','15:27'],['Speedrunning a Bad Decision','2026-10-28','12:58'],['Chat Decides My Weekend','2026-10-26','27:33'],
      ['I Read Every Comment','2026-10-24','21:16'],['The Debate That Went Off the Rails','2026-10-21','42:09'],['Ranking Your Worst Takes','2026-10-19','19:44'],
      ['Building a PC With Chat','2026-10-17','35:12'],['A Very Normal Stream','2026-10-14','16:01'],['Fact Checking Myself','2026-10-12','22:48']
    ],
    appearances:[
      ['Guest Spot: The Long Form Podcast','2026-10-29','1:42:10'],['Debate Panel: Tech and Society','2026-10-22','58:31'],
      ['Charity Stream Crossover','2026-10-11','2:10:44'],['Interviewed on Morning Signal','2026-10-04','24:02']
    ],
    clips:[
      ['He actually said it','2026-11-03','0:34'],['Chat was right (again)','2026-11-02','0:51'],['The chair incident','2026-10-31','0:22'],
      ['Speed of light take','2026-10-30','0:45'],['Nobody move','2026-10-27','0:18'],['5 second mute','2026-10-25','0:29'],['W raid','2026-10-23','0:57'],['That\u2019s not how that works','2026-10-20','0:40']
    ]
  },
  merch:[
    {name:'Ater Logo Tee, Black',price:'$32',kind:'tee'},{name:'Rainbow Line Hoodie',price:'$58',kind:'hoodie'},
    {name:'Enamel Pin Set',price:'$14',kind:'pins'},{name:'Sticker Pack, Vol. 2',price:'$8',kind:'sticker'}
  ],
  about:[
    'Inoater streams most nights across Twitch, Kick and YouTube at the same time: games, debates, the news, and whatever chat drags in.',
    'Ater started as a tool for reading all three chats at once without missing a link or a mention. This site is the same idea grown up: the stream, every chat, the schedule and the archive, in one place.'
  ]
};
