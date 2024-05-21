import fs from 'fs'
import clonedeep = require('clone-deep')

import { Coordinator, ChunkInfo, ChunkDownloadInfo } from './coordinator'
import {
    Attestation,
    Ceremony,
    Setup,
    SetupParameters,
    ChunkData,
    LockedChunkData,
    ReadonlyCeremony,
    UniqueChunkId,
} from './ceremony'
import { isContributorData } from './contribution-data'
import { isVerificationData } from './verification-data'
import { logger } from './logger'

function timestamp(): string {
    return new Date().toISOString()
}

function isVerified({ contributions }: ChunkData): boolean {
    return contributions.every((a) => a.verified)
}

function hasContributed(id: string, { contributions }: ChunkData): boolean {
    return contributions.some((a) => a.contributorId == id)
}

export class DiskCoordinator implements Coordinator {
    dbPath: string
    db: Ceremony

    static init({
        config,
        dbPath,
        initialVerifiers = null,
        force = false,
    }: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: any
        dbPath: string
        initialVerifiers?: string[]
        force?: boolean
    }): void {
        const configVersion =
            typeof config.version === 'undefined' ? 0 : config.version
        if (!force && fs.existsSync(dbPath)) {
            const ceremony = JSON.parse(fs.readFileSync(dbPath).toString())
            if (ceremony.version >= configVersion) {
                return
            }
        }

        config = JSON.parse(JSON.stringify(config))
        if (!config.verifierIds) {
            config.verifierIds = []
        }
        if (!config.attestations) {
            config.attestations = []
        }
        if (initialVerifiers) {
            config.verifierIds = config.verifierIds.concat(initialVerifiers)
        }
        logger.info('args %o', initialVerifiers)
        logger.info('config %o', config.verifierIds)

        config.setups = config.setups || []

        // Add metadata fields if they're missing.
        for (const setup of config.setups) {
            for (const lockedChunk of setup.chunks) {
                // Add parameters if they're falsy in the setup
                setup.parameters = setup.parameters || {
                    provingSystem: 'groth16',
                    curveKind: 'bw6',
                    batchSize: 64,
                    chunkSize: 512,
                    power: 10,
                }

                lockedChunk.metadata = lockedChunk.metadata ?? {
                    lockHolderTime: null,
                }
                for (const contribution of lockedChunk.contributions) {
                    contribution.metadata = contribution.metadata ?? {
                        contributedTime: null,
                        contributedLockHolderTime: null,
                        contributedData: null,
                        verifiedTime: null,
                        verifiedLockHolderTime: null,
                        verifiedData: null,
                    }
                }
            }
        }

        fs.writeFileSync(dbPath, JSON.stringify(config, null, 2))
    }

    constructor({ dbPath }: { dbPath: string }) {
        this.dbPath = dbPath
        this.db = JSON.parse(fs.readFileSync(this.dbPath).toString())
    }

    _writeDb(): void {
        this.db.version += 1
        fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2))
    }

    getCeremony(): ReadonlyCeremony {
        return this.db
    }

    changeKey(oldParticipantId: string, newParticipantId: string): void {
        const ceremony = this.db
        const index = ceremony.contributorIds.findIndex(
            (participantId) => participantId == oldParticipantId,
        )
        if (index == -1) {
            throw new Error(`Unknown participantId ${oldParticipantId}`)
        }

        // Check that there are no contributions
        for (const setup of ceremony.setups) {
            const setupId = setup.setupId
            if (
                this.getNumNonContributedChunks(setupId, oldParticipantId) !=
                this.getNumChunks(setupId)
            ) {
                throw new Error(
                    `Participant ${oldParticipantId} already contributed`,
                )
            }
        }

        this.db.contributorIds[index] = newParticipantId

        this._writeDb()
    }

    getParameters(setupId: string): SetupParameters {
        return clonedeep(DiskCoordinator._getSetup(this.db, setupId).parameters)
    }

    getNumNonContributedChunks(setupId: string, contributorId: string): number {
        const ceremony = this.db
        return DiskCoordinator._getSetup(ceremony, setupId).chunks.filter(
            (a) => !hasContributed(contributorId, a),
        ).length
    }

    getLockedChunks(setupId: string, contributorId: string): UniqueChunkId[] {
        const ceremony = this.db
        return DiskCoordinator._getSetup(ceremony, setupId)
            .chunks.filter((a) => a.lockHolder == contributorId)
            .map(({ uniqueChunkId }) => uniqueChunkId)
    }

    getPhase(): string {
        return this.db.phase
    }

    addAttestation(att: Attestation, participantId: string): void {
        if (att.publicKey != participantId) {
            throw new Error('adding attestation to wrong participant')
        }
        const ceremony = this.db
        if (!ceremony.attestations) {
            ceremony.attestations = []
        }
        if (!ceremony.attestations.some((a) => a.publicKey == participantId)) {
            ceremony.attestations.push(att)
            this._writeDb()
        }
    }

    getContributorChunks(setupId: string, contributorId: string): ChunkInfo[] {
        const ceremony = this.db
        const setup = DiskCoordinator._getSetup(ceremony, setupId)

        return setup.chunks
            .filter((a) => !hasContributed(contributorId, a) && isVerified(a))
            .map(({ lockHolder, uniqueChunkId }) => {
                return {
                    parameters: setup.parameters,
                    uniqueChunkId,
                    lockHolder,
                }
            })
    }

    getVerifierChunks(setupId: string): ChunkInfo[] {
        const ceremony = this.db
        const setup = DiskCoordinator._getSetup(ceremony, setupId)

        return setup.chunks
            .filter((a) => !isVerified(a))
            .map(({ lockHolder, uniqueChunkId }) => {
                return {
                    setupId,
                    parameters: setup.parameters,
                    uniqueChunkId,
                    lockHolder,
                }
            })
    }

    getNumChunks(setupId: string): number {
        return DiskCoordinator._getSetup(this.db, setupId).chunks.length
    }

    getMaxLocks(): number {
        return this.db.maxLocks
    }

    getShutdownSignal(): boolean {
        return this.db.shutdownSignal
    }

    setShutdownSignal(signal: boolean): void {
        this.db.shutdownSignal = signal
        this._writeDb()
    }

    static _getChunk(
        ceremony: Ceremony,
        uniqueChunkId: UniqueChunkId,
    ): LockedChunkData {
        const chunk = DiskCoordinator._getSetup(
            ceremony,
            uniqueChunkId.setupId,
        ).chunks.find(
            (chunk) =>
                chunk.uniqueChunkId.chunkId == uniqueChunkId.chunkId &&
                chunk.uniqueChunkId.setupId == uniqueChunkId.setupId,
        )
        if (!chunk) {
            throw new Error(
                `Unknown chunkId ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId}`,
            )
        }
        return chunk
    }

    static _getSetup(ceremony: Ceremony, setupId: string): Setup {
        const setup = ceremony.setups.find((setup) => setup.setupId == setupId)
        if (!setup) {
            throw new Error(`Unknown setupId ${setupId}`)
        }
        return setup
    }

    setCeremony(newCeremony: Ceremony): void {
        if (this.db.version !== newCeremony.version) {
            throw new Error(
                `New ceremony is out of date: ${this.db.version} vs ${newCeremony.version}`,
            )
        }
        this.db = clonedeep(newCeremony)
        this._writeDb()
    }

    getChunk(uniqueChunkId: UniqueChunkId): LockedChunkData {
        return clonedeep(DiskCoordinator._getChunk(this.db, uniqueChunkId))
    }

    getChunkDownloadInfo(uniqueChunkId: UniqueChunkId): ChunkDownloadInfo {
        const { lockHolder, contributions } = DiskCoordinator._getChunk(
            this.db,
            uniqueChunkId,
        )
        return {
            uniqueChunkId,
            lockHolder,
            lastResponseUrl:
                contributions.length > 0
                    ? contributions[contributions.length - 1]
                          .contributedLocation
                    : null,
            lastChallengeUrl:
                contributions.length > 0
                    ? contributions[contributions.length - 1].verifiedLocation
                    : null,
            previousChallengeUrl:
                contributions.length > 1
                    ? contributions[contributions.length - 2].verifiedLocation
                    : null,
        }
    }

    tryLockChunk(uniqueChunkId: UniqueChunkId, participantId: string): boolean {
        const chunk = DiskCoordinator._getChunk(this.db, uniqueChunkId)
        if (chunk.lockHolder) {
            if (chunk.lockHolder == participantId) {
                return false
            } else {
                throw new Error(
                    `${participantId} can't lock chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId} since it's already locked by ${chunk.lockHolder}`,
                )
            }
        }

        const holding = DiskCoordinator._getSetup(
            this.db,
            uniqueChunkId.setupId,
        ).chunks.filter((chunk) => chunk.lockHolder === participantId)
        if (holding.length >= this.db.maxLocks) {
            throw new Error(
                `${participantId} already holds too many locks (${holding.length}) on chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId}`,
            )
        }

        //
        // Return false if contributor trying to lock unverified chunk or
        // if verifier trying to lock verified chunk.
        // Also return false if contributor has already contributed
        // to the chunk.
        const verifier = this.db.verifierIds.includes(participantId)
        if (!verifier && hasContributed(participantId, chunk)) {
            throw new Error(
                `${participantId} can't lock chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId} since they already contributed to it`,
            )
        }
        const lastContribution =
            chunk.contributions[chunk.contributions.length - 1]
        if (lastContribution.verified === verifier) {
            throw new Error(
                `${participantId} can't lock chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId} since it's either verified and they're a verifier or it's unverified and they're a contributor`,
            )
        }

        chunk.lockHolder = participantId
        chunk.metadata.lockHolderTime = timestamp()
        this._writeDb()
        return true
    }

    tryUnlockChunk(
        uniqueChunkId: UniqueChunkId,
        participantId: string,
    ): boolean {
        const chunk = DiskCoordinator._getChunk(this.db, uniqueChunkId)
        if (chunk.lockHolder !== participantId) {
            throw new Error(
                `${participantId} does not hold lock on chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId}`,
            )
        }

        chunk.lockHolder = null
        chunk.metadata.lockHolderTime = timestamp()
        this._writeDb()
        return true
    }

    async contributeChunk({
        uniqueChunkId,
        participantId,
        location,
        signedData,
    }: {
        uniqueChunkId: UniqueChunkId
        participantId: string
        location: string
        signedData: object
    }): Promise<void> {
        const chunk = DiskCoordinator._getChunk(this.db, uniqueChunkId)
        if (chunk.lockHolder !== participantId) {
            throw new Error(
                `Participant ${participantId} does not hold lock ` +
                    `on chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId}`,
            )
        }
        const now = timestamp()
        const verifier = this.db.verifierIds.includes(participantId)
        if (verifier) {
            if (!isVerificationData(signedData)) {
                throw new Error(
                    `Data for chunk ${uniqueChunkId.setupId}-${
                        uniqueChunkId.chunkId
                    } by participant ${participantId} is not valid verification data: ${JSON.stringify(
                        signedData,
                    )}`,
                )
            }
            const contribution =
                chunk.contributions[chunk.contributions.length - 1]
            const contributorSignedData = contribution.contributedData
            if (!isContributorData(contributorSignedData)) {
                throw new Error(
                    `Data for chunk ${uniqueChunkId.setupId}-${
                        uniqueChunkId.chunkId
                    } by participant ${participantId} during verification is not valid contributor data: ${JSON.stringify(
                        contributorSignedData,
                    )}`,
                )
            }
            if (
                contributorSignedData.data.challengeHash !==
                signedData.data.challengeHash
            ) {
                throw new Error(
                    `During verification for chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId} by participant ${participantId}, contribution and verification challenge hashes were different: ${contributorSignedData.data.challengeHash} != ${signedData.data.challengeHash}`,
                )
            }
            if (
                contributorSignedData.data.responseHash !==
                signedData.data.responseHash
            ) {
                throw new Error(
                    `During verification for chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId} by participant ${participantId}, contribution and verification response hashes were different: ${contributorSignedData.data.responseHash} != ${signedData.data.responseHash}`,
                )
            }
            contribution.verifierId = participantId
            contribution.verifiedLocation = location
            contribution.verified = true
            contribution.verifiedData = signedData
            contribution.metadata.verifiedTime = now
            contribution.metadata.verifiedLockHolderTime =
                chunk.metadata.lockHolderTime
        } else {
            if (!isContributorData(signedData)) {
                throw new Error(
                    `Data for chunk ${uniqueChunkId.setupId}-${
                        uniqueChunkId.chunkId
                    } by participant ${participantId} is not valid contributor data: ${JSON.stringify(
                        signedData,
                    )}`,
                )
            }
            const previousContribution =
                chunk.contributions[chunk.contributions.length - 1]
            const previousVerificationSignedData =
                previousContribution.verifiedData
            if (!isVerificationData(previousVerificationSignedData)) {
                throw new Error(
                    `During contribution for chunk ${uniqueChunkId.setupId}-${
                        uniqueChunkId.chunkId
                    } by participant ${participantId}, data is not valid verification data: ${JSON.stringify(
                        signedData,
                    )}`,
                )
            }
            if (
                signedData.data.challengeHash !==
                previousVerificationSignedData.data.newChallengeHash
            ) {
                throw new Error(
                    `During contribution for chunk ${uniqueChunkId.setupId}-${uniqueChunkId.chunkId} by participant ${participantId}, contribution and verification challenge hashes were different: ${signedData.data.challengeHash} != ${previousVerificationSignedData.data.newChallengeHash}`,
                )
            }
            chunk.contributions.push({
                metadata: {
                    contributedTime: now,
                    contributedLockHolderTime: chunk.metadata.lockHolderTime,
                    verifiedTime: null,
                    verifiedLockHolderTime: null,
                },
                contributorId: participantId,
                contributedLocation: location,
                contributedData: signedData,
                verifierId: null,
                verifiedLocation: null,
                verified: false,
                verifiedData: null,
            })
        }
        chunk.lockHolder = null
        chunk.metadata.lockHolderTime = now
        this._writeDb()
    }

    getRound(): number {
        return this.db.round
    }
}
