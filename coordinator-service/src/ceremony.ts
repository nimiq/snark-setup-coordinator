export interface ChunkContributionMetadata {
    contributedTime: string
    contributedLockHolderTime: string
    verifiedTime: string
    verifiedLockHolderTime: string
}

export interface ChunkContribution {
    metadata: ChunkContributionMetadata

    contributorId: string
    contributedLocation: string
    contributedData: object
    verifierId: string
    verifiedLocation: string
    verified: boolean
    verifiedData: object
}

export interface ChunkData {
    parameters: SetupParameters
    uniqueChunkId: UniqueChunkId
    contributions: ChunkContribution[]
}

export interface LockedChunkDataMetadata {
    lockHolderTime: string
}

export interface LockedChunkData extends ChunkData {
    metadata: LockedChunkDataMetadata
    lockHolder: string
}

export interface UniqueChunkId {
    setupId: string
    chunkId: string
}

export interface SetupParameters {
    provingSystem?: string
    curveKind: string
    chunkSize: number
    batchSize: number
    power: number
}

export interface Attestation {
    id: string
    publicKey: string
    signature: string
}

export interface Setup {
    setupId: string
    parameters: SetupParameters
    chunks: LockedChunkData[]
}

export interface Ceremony {
    contributorIds: string[]
    verifierIds: string[]
    attestations: Attestation[]
    setups: Setup[]
    version: number
    round: number
    maxLocks: number
    shutdownSignal: boolean
    phase: string
}

type DeepReadonly<T> = {
    readonly [P in keyof T]: DeepReadonly<T[P]>
}

export type ReadonlyCeremony = DeepReadonly<Ceremony>
