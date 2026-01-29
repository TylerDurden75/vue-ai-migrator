/**
 * Core interfaces for vue-ai-migrator
 * These interfaces define contracts between modules to reduce coupling
 */

import { Transform } from 'jscodeshift';
import { ClassificationResult } from '../core/classifier';
import { DiffResult } from '../utils/codegen';

/**
 * Transformation interface for codemods
 */
export interface ITransformation {
  name: string;
  transform: Transform;
  description?: string;
}

/**
 * Cache manager interface
 */
export interface ICacheManager {
  needsProcessing(filePath: string, content: string, transformations: string[]): boolean;
  markProcessed(filePath: string, content: string, transformations: string[]): void;
  loadCache(): Promise<void>;
  saveCache(): Promise<void>;
  clearCache(): void;
}

/**
 * Project analyzer interface
 */
export interface IProjectAnalyzer {
  analyzeProject(projectPath: string): Promise<ProjectAnalysis>;
  detectVueVersion(projectPath: string): Promise<string | null>;
}

/**
 * Rollback manager interface
 */
export interface IRollbackManager {
  createBackup(filePath: string, content: string): Promise<void>;
  backupFile(filePath: string): Promise<void>;
  restoreFile(filePath: string): Promise<boolean>;
  restoreAll(): Promise<{ restored: number; failed: string[] }>;
  loadBackups(): Promise<void>;
  hasBackup(filePath: string): boolean;
  getBackupCount(): number;
}

/**
 * AI service interface
 */
export interface IAIService {
  migrate(context: MigrationContext): Promise<AgentResponse>;
  generateTests(context: MigrationContext): Promise<string | null>;
  explainChanges(context: MigrationContext): Promise<string | null>;
  analyzeComplexity(code: string): Promise<ComplexityAnalysis>;
}

/**
 * Test generator interface
 */
export interface ITestGenerator {
  generateTest(
    componentPath: string,
    code: string,
    apiStyle: 'composition' | 'script-setup'
  ): Promise<string>;
  writeTest(testPath: string, testCode: string): Promise<void>;
}

/**
 * Package migrator interface
 */
export interface IPackageMigrator {
  migratePackageJson(projectPath: string): Promise<PackageMigrationResult>;
}

/**
 * Post-migration validator interface
 */
export interface IPostMigrationValidator {
  validateMigration(filePath: string, code: string): Promise<ValidationResult>;
}

/**
 * File processor interface
 */
export interface IFileProcessor {
  processFile(
    filePath: string,
    content: string,
    options: FileProcessingOptions
  ): Promise<FileProcessingResult>;
}

/**
 * Migration pipeline interface
 */
export interface IMigrationPipeline {
  execute(options: PipelineOptions): Promise<PipelineResult>;
}

// Type definitions

export interface ProjectAnalysis {
  vueVersion: string | null;
  vueFiles: string[];
  components: string[];
  vue2Patterns: string[];
}

export interface MigrationContext {
  code: string;
  filePath: string;
  issues: string[];
  classification: 'simple' | 'medium' | 'complex';
  relatedFiles?: string[];
  vueVersion?: string;
}

export interface AgentResponse {
  success: boolean;
  migratedCode?: string;
  explanation?: string;
  suggestions?: string[];
  tests?: string;
  confidence?: number;
  reason?: string;
}

export interface ComplexityAnalysis {
  complexity: 'low' | 'medium' | 'high';
  recommendations: string[];
}

export interface PackageMigrationResult {
  modified: boolean;
  changes: string[];
  warnings: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export interface FileProcessingOptions {
  transformations: string[];
  useAI: boolean;
  aiService?: IAIService;
  generateTests: boolean;
  showDiff: boolean;
  classifyFiles: boolean;
}

export interface FileProcessingResult {
  modified: boolean;
  code: string;
  transformationsApplied: number;
  needsAI: boolean;
  issues: string[];
  classification?: ClassificationResult;
  diff?: DiffResult;
  explanation?: string;
  testCode?: string;
}

export interface PipelineOptions {
  files: string[];
  projectPath: string;
  transformations: string[];
  useAI: boolean;
  aiService?: IAIService;
  dryRun: boolean;
  generateTests: boolean;
  showDiff: boolean;
  classifyFiles: boolean;
}

export interface PipelineResult {
  filesProcessed: number;
  filesModified: number;
  transformationsApplied: number;
  errors: string[];
  warnings: string[];
  fileResults: Map<string, FileProcessingResult>;
}
