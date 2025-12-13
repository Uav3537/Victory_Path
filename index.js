const crypto = require("crypto")
const fastify = require("fastify")({logger: false})
const fastify_cors = require("@fastify/cors")
const { platform } = require("os")
const {pa} = require("./resources/module.cjs")

const p = pa
//테스트
fastify.register(fastify_cors, {
  origin: "*"
})

fastify.listen({port: 3000}, (err, address) => {
  console.log(`✅fastify running in ${address}`)
})

fastify.addHook("preHandler", async(request, reply) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  request.parseUrl = url
  const config = (await p.supabaseAPI("select", "config")).at(-1)
  if(!(request.body["cookies"] && request.headers["href"] && request.body["manifest"])) return reply.code(400).send({error: 'Bad Request', retry: false})
  request.cookies = request.body["cookies"]
  request.href = request.headers["href"]
  if(config.version > Number(request.body["manifest"].version)) return reply.code(426).send({error: 'Upgrade Required', retry: false, version: config.version})
  if(request.parseUrl.pathname == "/register") return
  if(!request.headers["authorization"]) return reply.code(401).send({error: 'Unauthorized', retry: false})
  const authorization = await p.findToken(1, request.headers["authorization"])
  if(!authorization) return reply.code(401).send({error: 'Unauthorized', retry: false})
  request.token = authorization
})

fastify.post("/register", async(request, reply) => {
  const [user] = await p.robloxAPI("authorization", [request.cookies?.[".ROBLOSECURITY"]], request.cookies)
  const token = await p.createToken(1, 30 * 60 * 1000, {
    cookies: request.cookies,
    user: user,
    href: request.href,
    position: request.ip,
  })
  return token
})

fastify.post("/list", async(request, reply) => {
  const list = request.body["target"]
  const access = [
    "teamerList",
    "memberList",
    "country"
  ]
  const res = await Promise.all(list.filter(i => access.includes(i)).map(async(i) => {
    const req = await p.supabaseAPI("select", i)
    let data = req
    if(i == "memberList" || i == "teamerList") {
      const [userList, imgList] = await Promise.all([
        p.robloxAPI("users", req.map(j => j.id), request.cookies, 20),
        p.robloxAPI("thumbnails", req.map(j => ({targetId: j.id})), request.cookies, 20)
      ])

      data = req.map(j => ({
        ...j,
        ...userList.find(t => t.id == j.id),
        img: imgList.find(t => t.id == j.id)?.img
      }))
    }
    return {requestId: i, data: data}
  }))
  return res
})

fastify.post("/apis/:type", async(request, reply) => {
  const res = await p.robloxAPI(request.params.type, request.body, request.cookies)
  return res
})

fastify.post("/track", async(request, reply) => {
  const res = await p.track(request.body.placeId, request.body.target, request.cookies)
  return res
})
