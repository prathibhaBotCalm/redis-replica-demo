import { ensureMasterConnection } from '@/lib/redis';
import * as baseLogger from '@/lib/logger';

const logger = baseLogger.createContextLogger('RepoCacheManager');

// Type for repository initialization function
type RepoInitializer<T> = () => Promise<T>;

// Type for repository cache entry
interface RepoCacheEntry<T> {
  repository: T;
  timestamp: number;
  lastUsed: number;
}

/**
 * Repository Cache Manager
 * Provides caching for repository instances with automatic invalidation
 */
export class RepoCacheManager {
  private static instance: RepoCacheManager;
  private repositoryCache: Map<string, RepoCacheEntry<any>> = new Map();
  private readonly defaultTTL: number;
  private readonly maxCacheSize: number;
  private readonly validationInterval: number;

  /**
   * Creates a new repository cache manager
   * @param defaultTTL Time-to-live for cached repositories in milliseconds (default: 30 seconds)
   * @param maxCacheSize Maximum number of repositories to cache (default: 10)
   * @param validationInterval How often to run validation in milliseconds (default: 2 minutes)
   */
  private constructor(
    defaultTTL = 30000,
    maxCacheSize = 10,
    validationInterval = 120000
  ) {
    this.defaultTTL = defaultTTL;
    this.maxCacheSize = maxCacheSize;
    this.validationInterval = validationInterval;

    // Start periodic validation
    setInterval(() => this.validateCachedRepositories(), validationInterval);

    logger.info(
      `Repository cache manager initialized with TTL: ${defaultTTL}ms, max size: ${maxCacheSize}`
    );
  }

  /**
   * Get the singleton instance of the repository cache manager
   */
  public static getInstance(): RepoCacheManager {
    if (!RepoCacheManager.instance) {
      RepoCacheManager.instance = new RepoCacheManager();
    }
    return RepoCacheManager.instance;
  }

  /**
   * Get a repository instance, either from cache or newly initialized
   * @param key Unique identifier for this repository type
   * @param initializer Function to initialize the repository if not cached
   * @param forceRefresh Whether to force a refresh of the repository
   * @param ttl Optional custom TTL for this repository
   * @returns The repository instance
   */
  public async getRepository<T>(
    key: string,
    initializer: RepoInitializer<T>,
    forceRefresh = false,
    ttl = this.defaultTTL
  ): Promise<T> {
    const now = Date.now();

    // Return from cache if valid and not forcing refresh
    if (!forceRefresh && this.repositoryCache.has(key)) {
      const entry = this.repositoryCache.get(key)!;

      // Check if the repository is still fresh
      if (now - entry.timestamp < ttl) {
        try {
          // Update last used timestamp
          entry.lastUsed = now;
          this.repositoryCache.set(key, entry);

          logger.debug(`Using cached repository for ${key}`);
          return entry.repository;
        } catch (err) {
          logger.warn(`Repository ${key} validation failed, refreshing`, err);
          // Continue to refresh the repository
        }
      } else {
        logger.debug(`Repository ${key} TTL expired, refreshing`);
      }
    }

    // If we need a new repository, ensure Redis master connection first
    try {
      await ensureMasterConnection();

      // Initialize the repository
      const repository = await initializer();

      // Store in cache
      this.repositoryCache.set(key, {
        repository,
        timestamp: now,
        lastUsed: now,
      });

      // Evict oldest entries if we're over the max cache size
      if (this.repositoryCache.size > this.maxCacheSize) {
        this.evictOldest();
      }

      logger.debug(`Repository ${key} initialized and cached`);
      return repository;
    } catch (err) {
      logger.error(`Failed to initialize repository ${key}:`, err);
      throw err;
    }
  }

  /**
   * Explicitly invalidate a cached repository
   * @param key The repository key to invalidate
   */
  public invalidate(key: string): void {
    if (this.repositoryCache.has(key)) {
      this.repositoryCache.delete(key);
      logger.debug(`Repository ${key} invalidated`);
    }
  }

  /**
   * Clear the entire repository cache
   */
  public clearCache(): void {
    this.repositoryCache.clear();
    logger.info('Repository cache cleared');
  }

  /**
   * Evict the least recently used repository from cache
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    // Find the least recently used repository
    for (const [key, entry] of this.repositoryCache.entries()) {
      if (entry.lastUsed < oldestTimestamp) {
        oldestTimestamp = entry.lastUsed;
        oldestKey = key;
      }
    }

    // Remove it from cache
    if (oldestKey) {
      this.repositoryCache.delete(oldestKey);
      logger.debug(`Evicted oldest cached repository: ${oldestKey}`);
    }
  }

  /**
   * Validate all cached repositories
   * Removes invalid or unreachable repositories
   */
  private async validateCachedRepositories(): Promise<void> {
    const now = Date.now();
    const keysToRemove: string[] = [];

    logger.debug(
      `Running validation on ${this.repositoryCache.size} cached repositories`
    );

    for (const [key, entry] of this.repositoryCache.entries()) {
      // Remove if beyond TTL
      if (now - entry.timestamp > this.defaultTTL * 2) {
        keysToRemove.push(key);
        continue;
      }

      // Try to validate with a simple operation
      try {
        // Only validate repositories that have validation methods
        if (typeof entry.repository.validate === 'function') {
          await entry.repository.validate();
        } else if (typeof entry.repository.search === 'function') {
          // For Redis-OM repositories, we can use search().return.count()
          await entry.repository.search().return.count();
        }
      } catch (err) {
        logger.warn(
          `Repository ${key} failed validation, will be removed`,
          err
        );
        keysToRemove.push(key);
      }
    }

    // Remove invalid repositories
    for (const key of keysToRemove) {
      this.repositoryCache.delete(key);
    }

    if (keysToRemove.length > 0) {
      logger.info(
        `Removed ${keysToRemove.length} invalid repositories from cache`
      );
    }
  }
}

// Helper methods to simplify usage
export const getRepositoryCacheManager = () => RepoCacheManager.getInstance();

/**
 * Get a repository instance from cache or initialize a new one
 * @param key Unique identifier for the repository
 * @param initializer Function to initialize the repository
 * @param forceRefresh Whether to force a refresh of the repository
 * @returns The repository instance
 */
export async function getRepository<T>(
  key: string,
  initializer: RepoInitializer<T>,
  forceRefresh = false
): Promise<T> {
  return await getRepositoryCacheManager().getRepository(
    key,
    initializer,
    forceRefresh
  );
}

/**
 * Invalidate a cached repository
 * @param key The repository key to invalidate
 */
export function invalidateRepository(key: string): void {
  getRepositoryCacheManager().invalidate(key);
}

/**
 * Clear the entire repository cache
 */
export function clearRepositoryCache(): void {
  getRepositoryCacheManager().clearCache();
}

// Export the main class for direct usage if needed
export default RepoCacheManager;
