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
    chunkId: string
    setupId: string
    parameters: SetupParameters
    contributions: ChunkContribution[]
}

export interface LockedChunkDataMetadata {
    lockHolderTime: string
}

export interface LockedChunkData extends ChunkData {
    metadata: LockedChunkDataMetadata
    lockHolder: string
}

export interface SetupParameters {
    provingSystem: string
    curveKind: string
    chunkSize: number
    batchSize: number
    power: number
}

export interface Setup {
    setupId: string
    parameters: SetupParameters
    chunks: LockedChunkData[]
}

export interface Ceremony {
    setups: Setup[]
    contributorIds: string[]
    verifierIds: string[]
    version: number
}
