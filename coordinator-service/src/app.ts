import bodyParser from 'body-parser'
import express from 'express'
import cors from 'cors'

import { authenticate, AuthenticateStrategy } from './authenticate'
import { authorize } from './authorize'
import { ChunkStorage, Coordinator } from './coordinator'
import { logger } from './logger'
import { isSignedData } from './signed-data'
import { Attestation } from './ceremony'

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        export interface Request {
            participantId?: string
        }
    }
}

export function isAttestation(a: object): a is Attestation {
    return a['signature'] && a['id'] && a['publicKey']
}

export function initExpress({
    authenticateStrategy,
    coordinator,
    chunkStorage,
}: {
    authenticateStrategy: AuthenticateStrategy
    coordinator: Coordinator
    chunkStorage: ChunkStorage
}): express.Application {
    const app = express()
    app.use(cors())
    const allowParticipants = authorize({
        coordinator,
        groups: ['verifierIds', 'contributorIds'],
    })
    const allowVerifiers = authorize({
        coordinator,
        groups: ['verifierIds'],
    })

    const authenticateRequests = authenticate(authenticateStrategy)

    app.get('/ceremony', (req, res) => {
        logger.debug('GET /ceremony')
        res.json({
            result: coordinator.getCeremony(),
            status: 'ok',
        })
    })

    app.put(
        '/ceremony',
        authenticateRequests,
        allowVerifiers,
        bodyParser.json({ limit: '1000mb' }),
        (req, res) => {
            const ceremony = req.body.setup
            const version = req.body.version
            logger.debug('PUT /ceremony')
            try {
                coordinator.setCeremony(ceremony)
                res.json({
                    status: 'ok',
                })
            } catch (err) {
                logger.warn(err.message)
                res.status(409).json({ status: 'error', message: err.message })
            }
        },
    )

    app.put(
        '/setup',
        authenticateRequests,
        allowVerifiers,
        bodyParser.json({ limit: '1000mb' }),
        (req, res) => {
            const setup = req.body.setup
            const version = req.body.version
            logger.debug('PUT /setup')
            try {
                coordinator.setSetup(version, setup)
                res.json({
                    status: 'ok',
                })
            } catch (err) {
                logger.warn(err.message)
                res.status(409).json({ status: 'error', message: err.message })
            }
        },
    )

    app.get('/contributor/:setupId-:chunkId/chunks', (req, res) => {
        const participantId = req.params.id
        const setupId = req.params.setupId
        logger.debug(`GET /contributor/${participantId}/chunks`)
        try {
            const chunks = coordinator.getContributorChunks(setupId, participantId)
            const lockedChunks = coordinator.getLockedChunks(setupId, participantId)
            const numNonContributed = coordinator.getNumNonContributedChunks(
                setupId,
                participantId,
            )
            const numChunks = coordinator.getNumChunks(setupId)
            const parameters = coordinator.getParameters(setupId)
            const maxLocks = coordinator.getMaxLocks()
            const shutdownSignal = coordinator.getShutdownSignal()
            const phase = coordinator.getPhase()
            res.json({
                status: 'ok',
                result: {
                    chunks,
                    lockedChunks,
                    numNonContributed,
                    parameters,
                    numChunks,
                    maxLocks,
                    shutdownSignal,
                    phase,
                },
            })
        } catch (err) {
            logger.warn(err.message)
            res.status(400).json({ status: 'error', message: err.message })
        }
    })

    app.get('/verifier/:setupId-:chunkId/chunks', (req, res) => {
        const participantId = req.params.id
        const setupId = req.params.setupId
        logger.debug(`GET /verifier/${participantId}/chunks`)
        try {
            const chunks = coordinator.getVerifierChunks(setupId)
            const lockedChunks = coordinator.getLockedChunks(setupId, participantId)
            const numNonContributed = chunks.length
            const numChunks = coordinator.getNumChunks(setupId)
            const parameters = coordinator.getParameters(setupId)
            const maxLocks = coordinator.getMaxLocks()
            const shutdownSignal = coordinator.getShutdownSignal()
            const phase = coordinator.getPhase()
            res.json({
                status: 'ok',
                result: {
                    chunks,
                    lockedChunks,
                    numNonContributed,
                    parameters,
                    numChunks,
                    maxLocks,
                    shutdownSignal,
                    phase,
                },
            })
        } catch (err) {
            logger.warn(err.message)
            res.status(400).json({ status: 'error', message: err.message })
        }
    })

    app.post(
        '/chunks/:setupId-:chunkId/lock',
        authenticateRequests,
        allowParticipants,
        (req, res) => {
            const participantId = req.participantId
            const setupId = req.params.setupId
            const chunkId = req.params.id
            logger.debug(`POST /chunks/${setupId}-${chunkId}/lock ${participantId}`)
            try {
                const locked = coordinator.tryLockChunk(setupId, chunkId, participantId)
                res.json({
                    status: 'ok',
                    result: {
                        chunkId,
                        locked,
                    },
                })
            } catch (err) {
                logger.warn(err.message)
                res.status(400).json({ status: 'error', message: err.message })
            }
        },
    )

    app.post(
        '/attest',
        authenticateRequests,
        allowParticipants,
        bodyParser.json(),
        (req, res) => {
            const participantId = req.participantId
            logger.debug(`POST /attest ${participantId}`)
            try {
                const body = req.body
                if (!isSignedData(body)) {
                    throw new Error(
                        `Body for attestation by participant ${participantId} should have been signed data: ${JSON.stringify(
                            body,
                        )}`,
                    )
                }
                const { data, signature } = body
                if (
                    !authenticateStrategy.verifyMessage(
                        data,
                        signature,
                        participantId,
                    )
                ) {
                    throw new Error(
                        `Could not verify signed data for attestation by participant ${participantId}`,
                    )
                }
                if (!isAttestation(data)) {
                    throw new Error(
                        `Bad attestation data for participant ${participantId}: ${JSON.stringify(
                            data,
                        )}`,
                    )
                }
                if (
                    !authenticateStrategy.verifyString(
                        data.id,
                        data.signature,
                        data.publicKey,
                    )
                ) {
                    throw new Error(
                        `Could not verify attestation by participant ${participantId}, data was ${JSON.stringify(
                            data,
                        )}`,
                    )
                }
                coordinator.addAttestation(data, participantId)
                res.json({
                    status: 'ok',
                    result: {},
                })
            } catch (err) {
                logger.warn(err.message)
                res.status(400).json({ status: 'error', message: err.message })
            }
        },
    )

    app.get('/chunks/:setupId-:chunkId/info', (req, res) => {
        const setupId = req.params.setupId
        const chunkId = req.params.id
        logger.debug(`GET /chunks/${setupId}-${chunkId}/info`)
        try {
            const chunk = coordinator.getChunkDownloadInfo(setupId, chunkId)
            res.json({
                status: 'ok',
                result: chunk,
            })
        } catch (err) {
            logger.warn(err.message)
            res.status(400).json({ status: 'error', message: err.message })
        }
    })

    app.post(
        '/chunks/:setupId-:chunkId/unlock',
        authenticateRequests,
        allowParticipants,
        bodyParser.json(),
        (req, res) => {
            const participantId = req.participantId
            const setupId = req.params.setupId
            const chunkId = req.params.id
            const error = req.body.error
            logger.debug(`POST /chunks/${setupId}-${chunkId}/unlock ${participantId}`)
            try {
                const unlocked = coordinator.tryUnlockChunk(
                    setupId,
                    chunkId,
                    participantId,
                )
                if (error) {
                    logger.error(
                        `participant ${participantId} reported error for chunk ${setupId}-${chunkId}: ${error}`,
                    )
                }
                res.json({
                    status: 'ok',
                    result: {
                        chunkId,
                        unlocked,
                        error,
                    },
                })
            } catch (err) {
                logger.warn(err.message)
                res.status(400).json({ status: 'error', message: err.message })
            }
        },
    )

    app.get(
        '/chunks/:setupId-:chunkId/contribution',
        authenticateRequests,
        allowParticipants,
        (req, res) => {
            const participantId = req.participantId
            const setupId = req.params.setupId
            const chunkId = req.params.id

            logger.debug(`GET /chunks/${setupId}-${chunkId}/contribution ${participantId}`)
            const chunk = coordinator.getChunk(setupId, chunkId)
            const round = coordinator.getRound()
            const writeUrl = chunkStorage.getChunkWriteLocation({
                setupId,
                round,
                chunk,
                participantId,
            })
            res.json({
                status: 'ok',
                result: {
                    chunkId,
                    participantId,
                    writeUrl,
                },
            })
        },
    )

    app.post(
        '/chunks/:setupId-:chunkId/contribution',
        authenticateRequests,
        allowParticipants,
        bodyParser.json(),
        async (req, res) => {
            const participantId = req.participantId
            const setupId = req.params.setupId
            const chunkId = req.params.id

            logger.debug(
                `POST /chunks/${setupId}-${chunkId}/contribution ${participantId}`,
            )
            const chunk = coordinator.getChunk(setupId, chunkId)
            const round = coordinator.getRound()

            let url
            try {
                url = await chunkStorage.copyChunk({
                    setupId,
                    round,
                    chunk,
                    participantId,
                })
            } catch (err) {
                logger.warn(err.message)
                res.status(400).json({
                    status: 'error',
                    message: 'Unable to copy contribution',
                })
                return
            }

            try {
                const body = req.body
                if (!isSignedData(body)) {
                    throw new Error(
                        `Body for chunk ${setupId}-${chunkId} by participant ${participantId} should have been signed data: ${JSON.stringify(
                            body,
                        )}`,
                    )
                }
                const { data, signature } = body
                if (
                    !authenticateStrategy.verifyMessage(
                        data,
                        signature,
                        participantId,
                    )
                ) {
                    throw new Error(
                        `Could not verify signed data for chunk ${setupId}-${chunkId} by participant ${participantId}`,
                    )
                }
                await coordinator.contributeChunk({
                    setupId,
                    chunkId,
                    participantId,
                    location: url,
                    signedData: body,
                })
                res.json({ status: 'ok' })
            } catch (err) {
                logger.warn(err.message)
                res.status(400).json({ status: 'error' })
            }
        },
    )

    app.post(
        '/shutdown-signal',
        authenticateRequests,
        allowVerifiers,
        bodyParser.json(),
        (req, res) => {
            logger.debug('POST /shutdown-signal')
            try {
                coordinator.setShutdownSignal(req.body.signal)
                res.json({
                    status: 'ok',
                })
            } catch (err) {
                logger.warn(err.message)
                res.status(400).json({ status: 'error', message: err.message })
            }
        },
    )

    return app
}
