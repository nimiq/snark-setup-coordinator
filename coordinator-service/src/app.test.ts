import chai from 'chai'
import chaiHttp from 'chai-http'
import path from 'path'
import tmp from 'tmp'

import { AuthenticateDummy } from './authenticate-dummy'
import { initExpress } from './app'
import { Ceremony } from './ceremony'
import { DiskCoordinator } from './disk-coordinator'
import { DiskChunkStorage } from './disk-chunk-storage'

const expect = chai.expect

chai.use(chaiHttp)
chai.should()

describe('app', () => {
    const chunkStorageUrl = 'http://doesnt-matter'

    let app
    let chunkStorage
    let coordinator
    let storageDir

    before(() => {
        storageDir = tmp.dirSync({ unsafeCleanup: true })
    })

    beforeEach(() => {
        const storagePath = storageDir.name
        const dbPath = path.join(storagePath, 'db.json')
        const testData = {
            data: {
                challengeHash:
                    '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                responseHash:
                    '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                newChallengeHash:
                    '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            },
            signature:
                '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        }
        const config = {
            round: 0,
            version: 0,
            maxLocks: 1,
            shutdownSignal: false,
            contributorIds: ['frank', 'becky', 'pat'],
            verifierIds: ['verifier0'],
            setups: [
                {
                    setupId: '1',
                    parameters: {
                        provingSystem: 'groth16',
                        curveKind: 'bw6',
                        chunkSize: 1024,
                        batchSize: 1024,
                        power: 12,
                    },
                    chunks: [
                        {
                            uniqueChunkId: { setupId: '1', chunkId: '1' },
                            lockHolder: null,
                            contributions: [
                                {
                                    contributorId: null,
                                    contributedLocation: null,
                                    verifiedLocation: '/some/location/1',
                                    verifierId: 'verifier0',
                                    verified: true,
                                    verifiedData: testData,
                                },
                            ],
                        },
                        {
                            uniqueChunkId: { setupId: '1', chunkId: '2' },
                            lockHolder: null,
                            contributions: [
                                {
                                    contributorId: 'pat',
                                    contributedLocation: '/some/location/2',
                                    contributedData: testData,
                                    verifierId: null,
                                    verifiedLocation: null,
                                    verified: false,
                                },
                            ],
                        },
                        {
                            uniqueChunkId: { setupId: '1', chunkId: '3' },
                            lockHolder: null,
                            contributions: [
                                {
                                    contributorId: 'pat',
                                    contributedLocation: '/some/location/2',
                                    contributedData: testData,
                                    verifierId: null,
                                    verifiedLocation: null,
                                    verified: true,
                                },
                            ],
                        },
                        {
                            uniqueChunkId: { setupId: '1', chunkId: '4' },
                            lockHolder: null,
                            contributions: [
                                {
                                    contributorId: 'pat',
                                    contributedLocation: '/some/location/2',
                                    contributedData: testData,
                                    verifierId: null,
                                    verifiedLocation: '/some/location/123',
                                    verified: true,
                                },
                                {
                                    contributorId: 'bill',
                                    contributedLocation: '/some/location/234',
                                    contributedData: testData,
                                    verifierId: null,
                                    verifiedLocation: null,
                                    verified: false,
                                },
                            ],
                        },
                    ],
                },
            ],
        }

        DiskCoordinator.init({ config, dbPath, force: true })
        chunkStorage = new DiskChunkStorage({ storagePath, chunkStorageUrl })
        coordinator = new DiskCoordinator({ dbPath })
        app = initExpress({
            authenticateStrategy: new AuthenticateDummy(),
            coordinator,
            chunkStorage,
        })
    })

    after(() => {
        storageDir.removeCallback()
    })

    describe('GET /ceremony', () => {
        it('returns ceremony', async () => {
            const res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)
        })
    })

    describe('PUT /ceremony', () => {
        it('updates ceremony', async () => {
            let res

            res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)

            const newCeremony = res.body.result
            newCeremony.setups[0].chunks[0].lockHolder = 'pat'

            res = await chai
                .request(app)
                .put('/ceremony')
                .set('authorization', 'dummy verifier0')
                .send(newCeremony)
            expect(res).to.have.status(200)

            res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)

            newCeremony.version = 1
            expect(res.body.result).to.deep.equal(newCeremony)
        })

        it('rejects invalid versions', async () => {
            let res

            res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)

            const originalCeremony = res.body.result
            const newCeremony = JSON.parse(JSON.stringify(res.body.result))
            newCeremony.version = 9999
            newCeremony.setups[0].chunks[0].lockHolder = 'pat'

            res = await chai
                .request(app)
                .put('/ceremony')
                .set('authorization', 'dummy verifier0')
                .send(newCeremony)
            expect(res).to.have.status(409)

            res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)
            expect(res.body.result).to.deep.equal(originalCeremony)
        })
    })

    describe('POST /change-key', () => {
        it('updates key', async () => {
            let res

            res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)

            const newCeremony = res.body.result

            res = await chai
                .request(app)
                .post('/change-key/becky/beck')
                .set('authorization', 'dummy verifier0')
            expect(res).to.have.status(200)

            res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)

            newCeremony.version = 1
            newCeremony.contributorIds = ['frank', 'beck', 'pat']
            expect(res.body.result).to.deep.equal(newCeremony)
        })

        it('rejects invalid updates', async () => {
            let res

            // Verifier only
            res = await chai.request(app).post('/change-key/becky/beck')
            expect(res).to.have.status(401)

            // Non-existant
            res = await chai
                .request(app)
                .post('/change-key/patty/patti')
                .set('authorization', 'dummy verifier0')
            expect(res).to.have.status(400)

            // Already contributed
            res = await chai
                .request(app)
                .post('/change-key/pat/patti')
                .set('authorization', 'dummy verifier0')
            expect(res).to.have.status(400)
        })
    })

    describe('GET /contributor/:participantId/chunks', () => {
        it('matches ceremony', async () => {
            const res = await chai.request(app).get('/contributor/pat/chunks')
            expect(res).to.have.status(200)
            const expected = {
                chunks: [
                    {
                        lockHolder: null,
                        uniqueChunkId: { setupId: '1', chunkId: '1' },
                        parameters: {
                            batchSize: 1024,
                            chunkSize: 1024,
                            curveKind: 'bw6',
                            power: 12,
                            provingSystem: 'groth16',
                        },
                    },
                ],
                lockedChunks: [],
                numNonContributed: 1,
                numChunks: 4,
                maxLocks: 1,
                shutdownSignal: false,
            }
            expect(res.body.result).to.deep.equal(expected)
        })

        it('a new contributor', async () => {
            const res = await chai.request(app).get('/contributor/bill/chunks')
            expect(res).to.have.status(200)
            expect(
                res.body.result.chunks.every((a) => !a.contributed),
            ).to.equal(true)
        })
    })

    describe('GET /chunks/:setupId-:chunkId/info', () => {
        it('info for chunk 1', async () => {
            const res = await chai.request(app).get('/chunks/1-1/info')
            expect(res).to.have.status(200)
            const expected = {
                uniqueChunkId: { setupId: '1', chunkId: '1' },
                lockHolder: null,
                lastResponseUrl: null,
                lastChallengeUrl: '/some/location/1',
                previousChallengeUrl: null,
            }
            expect(res.body.result).to.deep.equal(expected)
        })
        it('info for chunk 2', async () => {
            const res = await chai.request(app).get('/chunks/1-2/info')
            expect(res).to.have.status(200)
            const expected = {
                uniqueChunkId: { setupId: '1', chunkId: '2' },
                lockHolder: null,
                lastResponseUrl: '/some/location/2',
                lastChallengeUrl: null,
                previousChallengeUrl: null,
            }
            expect(res.body.result).to.deep.equal(expected)
        })
        it('info for chunk 4', async () => {
            const res = await chai.request(app).get('/chunks/1-4/info')
            expect(res).to.have.status(200)
            const expected = {
                uniqueChunkId: { setupId: '1', chunkId: '4' },
                lockHolder: null,
                lastResponseUrl: '/some/location/234',
                lastChallengeUrl: null,
                previousChallengeUrl: '/some/location/123',
            }
            expect(res.body.result).to.deep.equal(expected)
        })
        it('info for unknown chunk', async () => {
            const res = await chai.request(app).get('/chunks/1-2345/info')
            expect(res).to.have.status(400)
        })
    })

    describe('GET /chunks/:setupId-:chunkId/lock', () => {
        it('locks unlocked chunk', async () => {
            const res = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
            expect(res).to.have.status(200)
            expect(res.body.result.uniqueChunkId.chunkId).to.equal('1')
            expect(res.body.result.uniqueChunkId.setupId).to.equal('1')
            expect(res.body.result.locked).to.equal(true)

            const resInfo = await chai
                .request(app)
                .get('/contributor/frank/chunks')
            expect(resInfo).to.have.status(200)
            expect(resInfo.body.result.lockedChunks).to.deep.equal([
                { setupId: '1', chunkId: '1' },
            ])
        })

        it('returns false if lock holder tries another lock', async () => {
            await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
            const res = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
            expect(res).to.have.status(200)
            expect(res.body.result.locked).to.equal(false)
        })

        it('rejects if contributor attempts to lock unverified', async () => {
            const res = await chai
                .request(app)
                .post('/chunks/1-2/lock')
                .set('authorization', 'dummy frank')
            expect(res).to.have.status(400)
        })

        it('rejects if contributor attempts to lock a chunk it has already contributed to', async () => {
            const res = await chai
                .request(app)
                .post('/chunks/1-3/lock')
                .set('authorization', 'dummy pat')
            expect(res).to.have.status(400)
        })

        it('rejects if verifier attempts to lock verified', async () => {
            const res = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy verifier0')
            expect(res).to.have.status(400)
        })

        it('accepts locks <= max locks and rejects otherwise', async () => {
            let res

            res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)

            const newCeremony = res.body.result
            newCeremony.maxLocks = 2

            res = await chai
                .request(app)
                .put('/ceremony')
                .set('authorization', 'dummy verifier0')
                .send(newCeremony)
            expect(res).to.have.status(200)

            res = await chai.request(app).get('/ceremony')
            expect(res).to.have.status(200)
            expect(res.body.result.maxLocks).to.equal(2)

            res = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
            expect(res).to.have.status(200)
            expect(res.body.result.locked).to.equal(true)

            res = await chai
                .request(app)
                .post('/chunks/1-3/lock')
                .set('authorization', 'dummy frank')
            expect(res).to.have.status(200)
            expect(res.body.result.locked).to.equal(true)

            res = await chai
                .request(app)
                .post('/chunks/1-4/lock')
                .set('authorization', 'dummy frank')
            expect(res).to.have.status(400)
        })
    })

    describe('GET /chunks/:setupId-:chunkId/unlock', () => {
        it('unlocks locked chunk', async () => {
            let res

            res = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
                .send({})
            expect(res).to.have.status(200)
            expect(res.body.result.uniqueChunkId.chunkId).to.equal('1')
            expect(res.body.result.uniqueChunkId.setupId).to.equal('1')
            expect(res.body.result.locked).to.equal(true)

            res = await chai
                .request(app)
                .post('/chunks/1-1/unlock')
                .set('authorization', 'dummy frank')
                .send({})
            expect(res).to.have.status(200)
            expect(res.body.result.uniqueChunkId.chunkId).to.equal('1')
            expect(res.body.result.uniqueChunkId.setupId).to.equal('1')
            expect(res.body.result.unlocked).to.equal(true)
        })

        it('returns 400 if participant does not hold lock', async () => {
            const res = await chai
                .request(app)
                .post('/chunks/1-1/unlock')
                .set('authorization', 'dummy frank')
                .send({})
            expect(res).to.have.status(400)
        })

        it('accepts an error', async () => {
            let res

            res = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
                .send({})
            expect(res).to.have.status(200)
            expect(res.body.result.uniqueChunkId.chunkId).to.equal('1')
            expect(res.body.result.uniqueChunkId.setupId).to.equal('1')
            expect(res.body.result.locked).to.equal(true)

            res = await chai
                .request(app)
                .post('/chunks/1-1/unlock')
                .set('authorization', 'dummy frank')
                .send({ error: 'stuff' })
            expect(res).to.have.status(200)
            expect(res.body.result.uniqueChunkId.chunkId).to.equal('1')
            expect(res.body.result.uniqueChunkId.setupId).to.equal('1')
            expect(res.body.result.unlocked).to.equal(true)
            expect(res.body.result.error).to.equal('stuff')
        })
    })

    describe('GET /chunks/:setupId-:chunkId/contribute', () => {
        it('returns a write URL', async () => {
            const res = await chai
                .request(app)
                .get('/chunks/1-1/contribution')
                .set('authorization', 'dummy frank')
            expect(res).to.have.status(200)
            expect(res.body.result.writeUrl).to.be.a('string')
        })
    })

    describe('POST /chunks/:setupId-:chunkId/contribute', () => {
        it('handles contribution copy failures', async () => {
            chunkStorage.copyChunk = (): string => {
                throw new Error('fail')
            }
            const lockRes = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
                .send({ signature: 'dummy-signature' })
            expect(lockRes).to.have.status(200)
            const contributionRes = await chai
                .request(app)
                .post('/chunks/1-1/contribution')
                .set('authorization', 'dummy frank')
            expect(contributionRes).to.have.status(400)
        })

        it('rejects unlocked chunk contributions', async () => {
            const res = await chai
                .request(app)
                .post('/chunks/1-1/contribution')
                .set('authorization', 'dummy frank')
                .send({
                    data: {
                        challengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                        responseHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(res).to.have.status(400)
        })

        it('accepts contributions to locked chunk', async () => {
            const setupId = '1'
            const lockRes = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
                .send({ signature: 'dummy-signature' })
            expect(lockRes).to.have.status(200)
            const contributionRes = await chai
                .request(app)
                .post('/chunks/1-1/contribution')
                .set('authorization', 'dummy frank')
                .send({
                    data: {
                        challengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                        responseHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(contributionRes).to.have.status(200)
            const ceremony: Ceremony = (
                await chai.request(app).get('/ceremony')
            ).body.result

            const chunk = ceremony.setups
                .find((setup) => setup.setupId === setupId)
                .chunks.find((chunk) => chunk.uniqueChunkId.chunkId === '1')
            expect(chunk.lockHolder).to.equal(null)
            const lockHolderTime = new Date(chunk.metadata.lockHolderTime)
            expect(lockHolderTime).to.be.greaterThan(new Date(null))
            const contribution =
                chunk.contributions[chunk.contributions.length - 1]
            const contributedTime = new Date(
                contribution.metadata.contributedTime,
            )
            expect(contributedTime).to.be.greaterThan(new Date(null))
        })

        it('rejects contributions with wrong contribution hash', async () => {
            const lockRes = await chai
                .request(app)
                .post('/chunks/1-1/lock')
                .set('authorization', 'dummy frank')
                .send({ signature: 'dummy-signature' })
            expect(lockRes).to.have.status(200)
            const contributionRes = await chai
                .request(app)
                .post('/chunks/1-1/contribution')
                .set('authorization', 'dummy frank')
                .send({
                    data: {
                        challengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
                        responseHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(contributionRes).to.have.status(400)
        })

        it('sets verified flag for verified contributions', async () => {
            const setupId = '1'
            const lockRes = await chai
                .request(app)
                .post('/chunks/1-2/lock')
                .set('authorization', 'dummy verifier0')
                .send({ signature: 'dummy-signature' })
            expect(lockRes).to.have.status(200)
            const contributionRes = await chai
                .request(app)
                .post('/chunks/1-2/contribution')
                .set('authorization', 'dummy verifier0')
                .send({
                    data: {
                        challengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                        responseHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                        newChallengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(contributionRes).to.have.status(200)
            const ceremony: Ceremony = (
                await chai.request(app).get('/ceremony')
            ).body.result
            const chunk = ceremony.setups
                .find((setup) => setup.setupId === setupId)
                .chunks.find((chunk) => chunk.uniqueChunkId.chunkId === '2')
            const contribution =
                chunk.contributions[chunk.contributions.length - 1]
            expect(contribution.verified).to.equal(true)
            const verifiedTime = new Date(contribution.metadata.verifiedTime)
            expect(verifiedTime).to.be.greaterThan(new Date(null))
        })

        it('rejects verified flag with wrong contribution hash', async () => {
            const lockRes = await chai
                .request(app)
                .post('/chunks/1-2/lock')
                .set('authorization', 'dummy verifier0')
                .send({ signature: 'dummy-signature' })
            expect(lockRes).to.have.status(200)
            const contributionRes = await chai
                .request(app)
                .post('/chunks/1-2/contribution')
                .set('authorization', 'dummy verifier0')
                .send({
                    data: {
                        challengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
                        responseHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                        newChallengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(contributionRes).to.have.status(400)
        })
        it('rejects verified flag with wrong response hash', async () => {
            const lockRes = await chai
                .request(app)
                .post('/chunks/1-2/lock')
                .set('authorization', 'dummy verifier0')
                .send({ signature: 'dummy-signature' })
            expect(lockRes).to.have.status(200)
            const contributionRes = await chai
                .request(app)
                .post('/chunks/1-2/contribution')
                .set('authorization', 'dummy verifier0')
                .send({
                    data: {
                        challengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                        responseHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
                        newChallengeHash:
                            '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(contributionRes).to.have.status(400)
        })
    })

    describe('POST /attest', () => {
        it('attests successfully', async () => {
            const res = await chai
                .request(app)
                .post('/attest')
                .set('authorization', 'dummy frank')
                .send({
                    data: {
                        signature: 'hello',
                        id: 'frank',
                        publicKey: 'frank',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(res).to.have.status(200)
        })

        it("attesting twice doesn't add twice", async () => {
            const res = await chai
                .request(app)
                .post('/attest')
                .set('authorization', 'dummy frank')
                .send({
                    data: {
                        signature: 'hello',
                        id: 'frank',
                        publicKey: 'frank',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(res).to.have.status(200)
            const res2 = await chai
                .request(app)
                .post('/attest')
                .set('authorization', 'dummy frank')
                .send({
                    data: {
                        signature: 'hello',
                        id: 'frank',
                        publicKey: 'frank',
                    },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(res2).to.have.status(200)
            const ceremony: Ceremony = (
                await chai.request(app).get('/ceremony')
            ).body.result
            expect(ceremony.attestations.length).to.equal(1)
        })

        it('attests for wrong participant', async () => {
            const res = await chai
                .request(app)
                .post('/attest')
                .set('authorization', 'dummy frank')
                .send({
                    data: { signature: 'hello', id: 'pat', publicKey: 'pat' },
                    signature:
                        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                })
            expect(res).to.have.status(400)
        })
    })
})
