const {createClient} = require('@supabase/supabase-js')
const {url, service_key} = require('./config.cjs')
const crypto = require('crypto')
const pa = {
    parse: function(data) {
        const isError = data instanceof Error
        if(isError) {
            return {success: false, data: null, error: data}
        }
        else {
            return {success: true, data: true, error: null}
        }
    },
    getUrlType : function(href) {
        const url = new URL(href)
        const domain = url.hostname
        const path = url.pathname.split("/").filter(i => i != "")
        const res = {
            url,
            domain,
            path
        }
        return res
    },
    sliceArray: function(array, chunkSize) {
        const result = []
        for (let i = 0; i < array.length; i += chunkSize) {
            result.push(array.slice(i, i + chunkSize))
        }
        return result
    },
    fetchGeneral : async function(url, option, count) {
        if(!count) count = 5
        let req = null
        for(let i=count;i>0;i=i-1) {
            try {
                const fetchOptions = {
                    ...option,
                    headers: {
                        ...(option.headers || {}),
                        "Content-Type": "application/json"
                    }
                }
                if(option.body) fetchOptions.body = JSON.stringify(option.body)
                req = await fetch(url, fetchOptions)
                if(req.ok) {
                    break
                }
                else {
                    if(req.status == 429) {
                        const retry = req.headers.get("Retry-After")
                        await new Promise(resolve => setTimeout(resolve, retry * 1000))
                    }
                    else {
                        await new Promise(resolve => setTimeout(resolve, 1.3**(count - i) * 1000))
                    }
                }
            }
            catch(err) {
                console.log("error", err)
                await new Promise(resolve => setTimeout(resolve, 1000))
            }
        }
        if(req.ok) {
            const res = await req.json()
            return res
        }
        else {
            throw new Error(`fetch failed: ${req?.status} ${req?.statusText || ''}`)
        }
    },
    supabase: createClient(
        url,
        service_key
    ),
    supabaseAPI: async function(type, table, data) {
        let res = null
        if(type == "select") {
            res = await this.supabase.from(table).select(data || "*")
        }
        else if(type == "insert") { 
            res = await this.supabase.from(table).insert(data)
        }
        else if(type == "delete") {
            res = await this.supabase.from(table).delete().match(data);
        }
        return res.data
    },
    createToken: async function(type, time, data) {
        const token = {
            expire: new Date(Date.now() + time),
            type: type,
            token: crypto.randomBytes(32).toString('hex'),
            data: data
        }
        await this.supabaseAPI("insert", "tokens", token)
        return token
    },
    findToken: async function(type, token) {
        const tokens = await this.supabaseAPI("select", "tokens")
        const now = Date.now()
        const res = tokens.find(i =>
            i.type == type
            && i.token == token
            && now <= new Date(i.expire).getTime()
        )
        return res?.data || null
    },
    robloxAPI: async function(type, input, cookies, tryCount) {
        const main = {
            "Cookie": `.ROBLOSECURITY=${cookies?.[".ROBLOSECURITY"]}`
        }
        if(type == "authorization") {
            const res = await Promise.all(input.map(async(i) => {
                try {
                    const req = await this.fetchGeneral(
                        `https://users.roblox.com/v1/users/authenticated`, {
                            method: "GET",
                            headers: {
                                "Cookie": `.ROBLOSECURITY=${i}`
                            }
                        },
                        tryCount
                    )
                    return req
                }
                catch {
                    return null
                }
            }))
            return res.flat()
        }
        else if(type == "usernames") {
            const arr = this.sliceArray(input.target, 100)
            const res = await Promise.all(arr.map(async(i) => {
                try {
                    const req = await this.fetchGeneral(
                        `https://users.roblox.com/v1/usernames/users`, {
                            method: "POST",
                            headers: main,
                            body: {
                                usernames: i,
                                excludeBannedUsers: false
                            }
                        },
                        tryCount
                    )
                    return req.data
                }
                catch {
                    return []
                }
            }))
            return res.flat()
        }
        else if(type == "users") {
            const res = await Promise.all(input.target.map(async(i) => {
                try {
                    const req = await this.fetchGeneral(
                        `https://users.roblox.com/v1/users/${i}`, {
                            method: "GET",
                            headers: main
                        },
                        tryCount
                    )
                    return req
                }
                catch {
                    return null
                }
            }))
            return res.flat()
        }
        else if(type == "presence") {
            const arr = this.sliceArray(input, 50)
            const res = await Promise.all(arr.map(async(i) => {
                try {
                    const req = await this.fetchGeneral(
                        `https://presence.roblox.com/v1/presence/users`, {
                            method: "POST",
                            headers: main,
                            body: {
                                userIds: i
                            }
                        },
                        tryCount
                    )
                    return req
                }
                catch {
                    return []
                }
            }))
            return res.flat()
        }
        else if(type == "thumbnails") {
            const batchList = input.target.map((val, i) => {
                const data = {...val}
                const def = {
                    size:  "150x150",
                    format: "png",
                    type: "AvatarHeadShot"
                }
                Object.keys(def).forEach(k => {
                    if (!data[k]) {
                        data[k] = def[k]
                    }
                })
                data.requestId = String(i)
                return data
            });
            const arr = this.sliceArray(batchList, 100)
            const res = await Promise.all(arr.map(async(i) => {
                try {
                    const req = await this.fetchGeneral(
                        `https://thumbnails.roblox.com/v1/batch`, {
                            method: "POST",
                            headers: main,
                            body: i
                        },
                        tryCount
                    )
                    return req.data
                }
                catch {
                    return []
                }
            }))
            const full = res.flat().map(i => {
                const batch = batchList.find(j => j.requestId == i.requestId)
                return {
                    img: i.imageUrl,
                    id: i.targetId || null,
                    token: batch.token || null,
                    jobId: batch.jobId || null,
                    type: batch.type,
                    size: batch.size,
                    format: batch.format
                }
            }).filter(i => i.img)
            return full
        }
        else if(type == "friends") {
            const res = await Promise.all(input.map(async(i) => {
                try {
                    const req = await this.fetchGeneral(
                        `https://friends.roblox.com/v1/users/${i}/friends`, {
                            method: "GET",
                            headers: main,
                        },
                        tryCount
                    )
                    return {targetId: i, data: req.data}
                }
                catch {
                    return {targetId: i, data: []}
                }
            }))
            return res.flat()
        }
        else if(type == "servers") {
            const count = input.count
            let cursor = input.cursor
            let server = []
            for(let i=0;i<count;i=i+1) {
                const link = (cursor)
                    ? `https://games.roblox.com/v1/games/${input.placeId}/servers/public?limit=100&cursor=${cursor}`
                    : `https://games.roblox.com/v1/games/${input.placeId}/servers/public?limit=100`
                const req = await this.fetchGeneral(link, {
                    method: "GET",
                    headers: main
                }, tryCount)
                const parse = await this.parseImage(input.placeId, req, input.format, cookies)
                server.push(parse)
                cursor = req?.nextPageCursor
                if(!cursor) break
            }
            const res = {
                previousPageCursor: server.at(0)?.previousPageCursor,
                nextPageCursor: server.at(-1)?.nextPageCursor,
                data: server.map(i => i.data).flat()
            }
            return res
        }
        else if(type == "serverDetail") {
            const res = await Promise.all(input.target.map(async(i) => {
                try {
                    const req = await this.fetchGeneral(
                        `https://gamejoin.roblox.com/v1/join-game-instance`, {
                            method: "POST",
                            headers: {
                                'User-Agent': 'Roblox/WinInet',
                                ...main
                            },
                            body: {
                                placeId: i.placeId,
                                gameId: i.jobId
                            }
                        },
                        tryCount
                    )
                    return req
                }
                catch(err) {
                    return err.message
                }
            }))
            return res
        }
        else {
            return new Error("No Type Found")
        }
    },
    parseImage: async function(placeId, server, format, roblosecurity) {
        const tokens = server.data.map(i => i.playerTokens.map(j => ({token: j, jobId: i.id, ...(format || {})}))).flat()
        const [thumbnails, serverData, ipSave] = await Promise.all([
            this.robloxAPI("thumbnails", {target: tokens}, roblosecurity),
            this.robloxAPI("serverDetail", {target: server.data.map(i => ({placeId: placeId, jobId: i.id}))}, roblosecurity),
            this.supabaseAPI("select", "ipSave")
        ])
        const ipList = serverData.map(i => ({jobId: i?.jobId, ip: i.joinScript?.UdmuxEndpoints?.[0]?.Address || i.joinScript?.MachineAddress}))
        const locationList = await Promise.all(ipList.map(async(i) => {
            const before = ipSave.find(j => j.ip == i.ip)
            if(before) {
                return {jobId: i?.jobId, location: before.data}
            }
            if(!i.ip) return
            const req = await this.fetchGeneral(`https://api.ipgeolocation.io/v2/ipgeo?apiKey=25e68f2433b94b8e976543823fa637a0&ip=${i.ip}`, {
                method: "GET",
                headers: {

                }
            })
            await this.supabaseAPI("insert", "ipSave", {ip : i?.ip, data: req?.location})
            return {jobId: i?.jobId, location: req?.location}
        }))
        const res = server.data.map(i => ({
            fps: i.fps,
            jobId: i.id,
            maxPlayers: i.maxPlayers,
            playing: i.playing,
            players: i.players,
            playerImg: thumbnails.filter(j => j.jobId == i.id).map(j => j.img),
            serverDetail: serverData.find(j => j.jobId == i.id),
            location: locationList.find(j => j?.jobId == i.id)?.location
        }))
        return {
            nextPageCursor: server.nextPageCursor,
            previousPageCursor: server.previousPageCursor,
            data: res
        }
    },
    track: async function(placeId, target, cookies) {
        const idList = target.filter(i => typeof i == "number")
        const textList = await this.robloxAPI("usernames", {target: target.filter(i => typeof i == "string")})
        textList.forEach(i => idList.push(i?.id))
        const [userList, imgList, serverList] = await Promise.all([
            this.robloxAPI("users", {target: idList}, cookies),
            this.robloxAPI("thumbnails", {target: idList.map(i => ({targetId: i}))}, cookies),
            this.robloxAPI("servers", {placeId: placeId, count: 1000}, cookies)
        ])
        const detailList = userList.map(i => ({
            img: imgList.find(j => j?.id == i?.id)?.img,
            ...i,
        }))
        const batchList = serverList.data
        const result = detailList.map(i => {
            let match = null
            for(const j of batchList) {
                const find = j.playerImg.some(t => t?.split("/")[3].split("-")[2] == i.img?.split("/")[3].split("-")[2])
                if(find) {
                    match = j
                    break
                }
            }
            return {
                user: i,
                server: match
            }
        })
        return result
    }
}

Object.defineProperty(Object.prototype, "getType", {
    value: function() {
        if (this === null) return "null";
        if (this === undefined) return "undefined";

        let value = this;
        if (typeof this.valueOf === "function") value = this.valueOf();

        const prim = typeof value;
        if (prim !== "object") return prim;

        const tag = Object.prototype.toString.call(value).slice(8, -1).toLowerCase();

        return tag;
    },
    writable: false,
    configurable: false,
    enumerable: false,
});

module.exports = {pa}