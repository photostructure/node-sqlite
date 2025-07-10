// Stress test scenarios for large-scale SQLite performance testing

import { randomInt as cryptoRandomInt } from "node:crypto";
import type { Driver, Statement } from "./drivers.js";

type StressScenarioContext = {
  statements: Record<string, Statement>;
  cleanup: () => void;
  // Additional properties can be added by specific scenarios
  [key: string]: any;
};

export interface StressScenario {
  name: string;
  description: string;
  setup: (driver: Driver) => StressScenarioContext;
  run: (context: StressScenarioContext, iteration?: number) => any;
  cleanup?: (context: StressScenarioContext) => void;
  iterations: number;
}

// Natural data generators without external dependencies
export class NaturalDataGenerator {
  private seed: number;
  private useSeededRandom: boolean;

  constructor(seed?: number) {
    this.seed = seed ?? 12345;
    this.useSeededRandom = seed !== undefined;
  }

  // Simple seeded random number generator
  private random(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  randomInt(min: number, max: number): number {
    if (this.useSeededRandom) {
      return Math.floor(this.random() * (max - min + 1)) + min;
    } else {
      return cryptoRandomInt(min, max + 1);
    }
  }

  private randomChoice<T>(array: T[]): T {
    return array[Math.floor(this.random() * array.length)];
  }

  // Natural name generation
  private firstNames = [
    "James",
    "Mary",
    "John",
    "Patricia",
    "Robert",
    "Jennifer",
    "Michael",
    "Linda",
    "William",
    "Elizabeth",
    "David",
    "Barbara",
    "Richard",
    "Susan",
    "Joseph",
    "Jessica",
    "Thomas",
    "Sarah",
    "Christopher",
    "Karen",
    "Charles",
    "Helen",
    "Daniel",
    "Nancy",
    "Matthew",
    "Betty",
    "Anthony",
    "Dorothy",
    "Mark",
    "Lisa",
    "Donald",
    "Sandra",
    "Steven",
    "Donna",
    "Paul",
    "Carol",
    "Andrew",
    "Ruth",
    "Joshua",
    "Sharon",
    "Kenneth",
    "Michelle",
    "Kevin",
    "Laura",
    "Brian",
    "Sarah",
    "George",
    "Kimberly",
  ];

  private lastNames = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
    "Hernandez",
    "Lopez",
    "Gonzalez",
    "Wilson",
    "Anderson",
    "Thomas",
    "Taylor",
    "Moore",
    "Jackson",
    "Martin",
    "Lee",
    "Perez",
    "Thompson",
    "White",
    "Harris",
    "Sanchez",
    "Clark",
    "Ramirez",
    "Lewis",
    "Robinson",
    "Walker",
    "Young",
    "Allen",
    "King",
    "Wright",
    "Scott",
    "Torres",
    "Nguyen",
    "Hill",
    "Flores",
    "Green",
    "Adams",
    "Nelson",
    "Baker",
    "Hall",
    "Rivera",
    "Campbell",
    "Mitchell",
  ];

  private domains = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "example.com",
    "company.com",
    "business.org",
    "test.net",
    "demo.co",
    "sample.io",
  ];

  private words = [
    "the",
    "be",
    "to",
    "of",
    "and",
    "a",
    "in",
    "that",
    "have",
    "I",
    "it",
    "for",
    "not",
    "on",
    "with",
    "he",
    "as",
    "you",
    "do",
    "at",
    "this",
    "but",
    "his",
    "by",
    "from",
    "they",
    "we",
    "say",
    "her",
    "she",
    "or",
    "an",
    "will",
    "my",
    "one",
    "all",
    "would",
    "there",
    "their",
    "what",
    "so",
    "up",
    "out",
    "if",
    "about",
    "who",
    "get",
    "which",
    "go",
    "when",
    "make",
    "can",
    "like",
    "time",
    "no",
    "just",
    "him",
    "know",
    "take",
    "people",
    "into",
    "year",
    "your",
    "good",
    "some",
    "could",
    "them",
    "see",
    "other",
    "than",
    "then",
    "now",
    "look",
    "only",
    "come",
    "its",
    "over",
    "think",
    "also",
    "back",
    "after",
    "use",
    "two",
    "how",
    "our",
    "work",
    "first",
    "well",
    "way",
    "even",
    "new",
    "want",
    "because",
    "any",
    "these",
    "give",
    "day",
    "most",
    "us",
    "technology",
    "software",
    "development",
    "programming",
    "database",
    "performance",
    "optimization",
    "scalability",
    "architecture",
    "framework",
    "library",
    "application",
    "system",
    "solution",
    "platform",
    "service",
    "product",
    "feature",
    "implementation",
  ];

  private categories = [
    "Technology",
    "Science",
    "Business",
    "Health",
    "Education",
    "Entertainment",
    "Sports",
    "Travel",
    "Food",
    "Lifestyle",
    "Politics",
    "Environment",
    "Art",
    "Music",
    "Literature",
    "Photography",
    "Gaming",
    "Fashion",
    "Finance",
    "Real Estate",
    "Automotive",
    "History",
    "Philosophy",
    "Psychology",
  ];

  private tags = [
    "tutorial",
    "guide",
    "tips",
    "howto",
    "best-practices",
    "review",
    "news",
    "analysis",
    "comparison",
    "deep-dive",
    "introduction",
    "advanced",
    "beginner",
    "expert",
    "featured",
    "trending",
    "popular",
    "latest",
    "breaking",
    "exclusive",
    "interview",
    "case-study",
    "research",
    "opinion",
    "discussion",
    "debate",
    "javascript",
    "python",
    "react",
    "nodejs",
    "typescript",
    "sql",
    "database",
    "web-development",
    "mobile",
    "cloud",
    "ai",
    "machine-learning",
    "blockchain",
  ];

  generateFirstName(): string {
    return this.randomChoice(this.firstNames);
  }

  generateLastName(): string {
    return this.randomChoice(this.lastNames);
  }

  generateFullName(): string {
    return `${this.generateFirstName()} ${this.generateLastName()}`;
  }

  generateEmail(uniqueSuffix?: string | number): string {
    const firstName = this.generateFirstName().toLowerCase();
    const lastName = this.generateLastName().toLowerCase();
    const domain = this.randomChoice(this.domains);
    const separator = this.randomChoice([".", "_", ""]);
    const suffix = uniqueSuffix !== undefined ? `+${uniqueSuffix}` : "";
    return `${firstName}${separator}${lastName}${suffix}@${domain}`;
  }

  generateText(minWords: number, maxWords: number): string {
    const wordCount = this.randomInt(minWords, maxWords);
    const words: string[] = [];

    for (let i = 0; i < wordCount; i++) {
      words.push(this.randomChoice(this.words));
    }

    // Capitalize first word and add some punctuation
    let text = words.join(" ");
    text = text.charAt(0).toUpperCase() + text.slice(1);

    // Add some periods for longer texts
    if (wordCount > 20) {
      const sentences = Math.floor(wordCount / 15);
      for (let i = 0; i < sentences; i++) {
        const pos = Math.floor((text.length * (i + 1)) / (sentences + 1));
        const nextSpace = text.indexOf(" ", pos);
        if (nextSpace > 0) {
          text =
            text.slice(0, nextSpace) +
            "." +
            (nextSpace + 1 < text.length
              ? " " +
                text.charAt(nextSpace + 1).toUpperCase() +
                text.slice(nextSpace + 2)
              : "");
        }
      }
    }

    return text + ".";
  }

  generateTitle(): string {
    const titleWords = this.randomInt(3, 8);
    const words: string[] = [];

    for (let i = 0; i < titleWords; i++) {
      let word = this.randomChoice(this.words);
      if (i === 0 || word.length > 3) {
        word = word.charAt(0).toUpperCase() + word.slice(1);
      }
      words.push(word);
    }

    return words.join(" ");
  }

  generateSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  }

  generateCategory(): string {
    return this.randomChoice(this.categories);
  }

  generateTag(): string {
    return this.randomChoice(this.tags);
  }

  generateJson(): string {
    const data: Record<string, any> = {};

    // Add random properties
    const propCount = this.randomInt(2, 6);
    const props = [
      "views",
      "likes",
      "shares",
      "rating",
      "featured",
      "verified",
      "premium",
      "sponsored",
    ];

    for (let i = 0; i < propCount; i++) {
      const prop = this.randomChoice(props);
      if (
        prop === "featured" ||
        prop === "verified" ||
        prop === "premium" ||
        prop === "sponsored"
      ) {
        data[prop] = this.random() > 0.7;
      } else {
        data[prop] = this.randomInt(0, 10000);
      }
    }

    // Add some nested data
    if (this.random() > 0.5) {
      data.metadata = {
        source: this.randomChoice(["web", "mobile", "api", "import"]),
        version: `${this.randomInt(1, 5)}.${this.randomInt(0, 9)}.${this.randomInt(0, 9)}`,
        timestamp: Date.now() - this.randomInt(0, 86400000 * 365), // Within last year
      };
    }

    return JSON.stringify(data);
  }

  generatePhoneNumber(): string {
    return `+1-${this.randomInt(200, 999)}-${this.randomInt(200, 999)}-${this.randomInt(1000, 9999)}`;
  }

  generateDate(startYear: number = 2020, endYear: number = 2024): number {
    const start = new Date(startYear, 0, 1).getTime();
    const end = new Date(endYear, 11, 31).getTime();
    return Math.floor(start + this.random() * (end - start));
  }
}

// Database schema creation
export function createStressSchema(driver: Driver): void {
  // Drop existing tables if they exist
  driver.exec(`
    DROP TABLE IF EXISTS post_tags;
    DROP TABLE IF EXISTS comments;
    DROP TABLE IF EXISTS posts_fts;
    DROP TABLE IF EXISTS posts;
    DROP TABLE IF EXISTS categories;
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS users;
  `);

  // Create tables with comprehensive schema
  driver.exec(`
    -- Users table with JSON metadata
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      bio TEXT,
      avatar_url TEXT,
      preferences JSON,
      stats JSON,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login INTEGER
    );

    -- Categories for content organization
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      meta JSON,
      created_at INTEGER NOT NULL
    );

    -- Tags for flexible content tagging
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      color TEXT,
      created_at INTEGER NOT NULL
    );

    -- Posts with rich content and metadata
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      excerpt TEXT,
      content TEXT NOT NULL,
      featured_image TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      metadata JSON,
      seo_data JSON,
      published_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
    );

    -- Comments with threading support
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved',
      metadata JSON,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    -- Many-to-many junction table for posts and tags
    CREATE TABLE post_tags (
      post_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, tag_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

  // Create comprehensive indexes
  driver.exec(`
    -- User indexes
    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_users_created_at ON users(created_at);
    CREATE INDEX idx_users_last_login ON users(last_login);

    -- Category indexes
    CREATE INDEX idx_categories_slug ON categories(slug);

    -- Tag indexes  
    CREATE INDEX idx_tags_slug ON tags(slug);

    -- Post indexes (including composite and partial indexes)
    CREATE INDEX idx_posts_user_id ON posts(user_id);
    CREATE INDEX idx_posts_category_id ON posts(category_id);
    CREATE INDEX idx_posts_status ON posts(status);
    CREATE INDEX idx_posts_published_at ON posts(published_at);
    CREATE INDEX idx_posts_created_at ON posts(created_at);
    
    -- Composite indexes for common query patterns
    CREATE INDEX idx_posts_status_published ON posts(status, published_at) WHERE status = 'published';
    CREATE INDEX idx_posts_user_status ON posts(user_id, status);
    CREATE INDEX idx_posts_category_published ON posts(category_id, published_at) WHERE status = 'published';
    
    -- Partial index for active posts only
    CREATE INDEX idx_posts_active_title ON posts(title) WHERE status IN ('published', 'featured');

    -- Comment indexes
    CREATE INDEX idx_comments_post_id ON comments(post_id);
    CREATE INDEX idx_comments_user_id ON comments(user_id);
    CREATE INDEX idx_comments_parent_id ON comments(parent_id);
    CREATE INDEX idx_comments_status ON comments(status);
    CREATE INDEX idx_comments_created_at ON comments(created_at);
    
    -- Composite index for threaded comments
    CREATE INDEX idx_comments_post_parent ON comments(post_id, parent_id);

    -- Post tags indexes
    CREATE INDEX idx_post_tags_tag_id ON post_tags(tag_id);
    CREATE INDEX idx_post_tags_created ON post_tags(created_at);
  `);

  // Create FTS5 virtual table for full-text search
  driver.exec(`
    CREATE VIRTUAL TABLE posts_fts USING fts5(
      title,
      excerpt,
      content,
      content_rowid=id,
      content=posts,
      tokenize='porter'
    );

    -- Populate FTS table with existing data (will be empty initially)
    INSERT INTO posts_fts(posts_fts) VALUES('rebuild');
  `);

  // Create triggers to keep FTS table in sync
  driver.exec(`
    CREATE TRIGGER posts_fts_insert AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, title, excerpt, content) 
      VALUES (new.id, new.title, new.excerpt, new.content);
    END;

    CREATE TRIGGER posts_fts_delete AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content) 
      VALUES('delete', old.id, old.title, old.excerpt, old.content);
    END;

    CREATE TRIGGER posts_fts_update AFTER UPDATE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content) 
      VALUES('delete', old.id, old.title, old.excerpt, old.content);
      INSERT INTO posts_fts(rowid, title, excerpt, content) 
      VALUES (new.id, new.title, new.excerpt, new.content);
    END;
  `);
}

// Data generation functions
export function generateLargeDataset(
  driver: Driver,
  targetSizeMB: number = 100,
): void {
  const generator = new NaturalDataGenerator();
  const now = Date.now();

  console.log(`Generating dataset targeting ${targetSizeMB}MB...`);

  // Calculate approximate record counts for 100MB
  // Based on estimated average row sizes
  const targetUsers = Math.floor(targetSizeMB * 1000); // ~100 bytes per user
  const targetCategories = 50;
  const targetTags = 200;
  const targetPosts = Math.floor(targetSizeMB * 200); // ~500 bytes per post
  const targetComments = Math.floor(targetSizeMB * 800); // ~125 bytes per comment
  const targetPostTags = Math.floor(targetSizeMB * 400); // ~25 bytes per relation

  // Generate in chunks to prevent memory issues
  const chunkSize = 1000;

  // 1. Generate categories (small dataset)
  console.log("Generating categories...");
  const insertCategory = driver.prepare(`
    INSERT INTO categories (name, slug, description, meta, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const categoryTx = driver.transaction((categories: any[]) => {
    for (const cat of categories) {
      insertCategory.run(
        cat.name,
        cat.slug,
        cat.description,
        cat.meta,
        cat.created_at,
      );
    }
  });

  const categories = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < targetCategories; i++) {
    let name = generator.generateCategory();
    // Ensure unique category names
    let suffix = 0;
    while (usedNames.has(name)) {
      suffix++;
      name = `${generator.generateCategory()} ${suffix}`;
    }
    usedNames.add(name);

    categories.push({
      name,
      slug: generator.generateSlug(name),
      description: generator.generateText(10, 30),
      meta: generator.generateJson(),
      created_at: generator.generateDate(2020, 2024),
    });
  }
  categoryTx(categories);
  insertCategory.finalize();

  // 2. Generate tags
  console.log("Generating tags...");
  const insertTag = driver.prepare(`
    INSERT INTO tags (name, slug, color, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const tagTx = driver.transaction((tags: any[]) => {
    for (const tag of tags) {
      insertTag.run(tag.name, tag.slug, tag.color, tag.created_at);
    }
  });

  const tags = [];
  const usedTagNames = new Set<string>();
  for (let i = 0; i < targetTags; i++) {
    let name = generator.generateTag();
    // Ensure unique tag names
    let suffix = 0;
    while (usedTagNames.has(name)) {
      suffix++;
      name = `${generator.generateTag()}-${suffix}`;
    }
    usedTagNames.add(name);

    tags.push({
      name,
      slug: generator.generateSlug(name),
      color: `#${Math.floor(generator.randomInt(0, 16777215)).toString(16).padStart(6, "0")}`,
      created_at: generator.generateDate(2020, 2024),
    });
  }
  tagTx(tags);
  insertTag.finalize();

  // 3. Generate users in chunks
  console.log("Generating users...");
  const insertUser = driver.prepare(`
    INSERT INTO users (first_name, last_name, email, phone, bio, avatar_url, preferences, stats, created_at, updated_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const userTx = driver.transaction((users: any[]) => {
    for (const user of users) {
      insertUser.run(
        user.first_name,
        user.last_name,
        user.email,
        user.phone,
        user.bio,
        user.avatar_url,
        user.preferences,
        user.stats,
        user.created_at,
        user.updated_at,
        user.last_login,
      );
    }
  });

  const totalUserChunks = Math.ceil(targetUsers / chunkSize);
  for (let chunk = 0; chunk < totalUserChunks; chunk++) {
    const users = [];
    const currentChunkSize = Math.min(
      chunkSize,
      targetUsers - chunk * chunkSize,
    );

    for (let i = 0; i < currentChunkSize; i++) {
      const firstName = generator.generateFirstName();
      const lastName = generator.generateLastName();
      const createdAt = generator.generateDate(2020, 2024);

      users.push({
        first_name: firstName,
        last_name: lastName,
        email: generator.generateEmail(chunk * chunkSize + i),
        phone: generator.generatePhoneNumber(),
        bio: generator.generateText(20, 100),
        avatar_url: `https://api.dicebear.com/7.x/personas/svg?seed=${firstName}-${lastName}`,
        preferences: generator.generateJson(),
        stats: generator.generateJson(),
        created_at: createdAt,
        updated_at: createdAt + generator.randomInt(0, now - createdAt),
        last_login: generator.generateDate(2023, 2024),
      });
    }

    userTx(users);

    if (chunk % 10 === 0) {
      console.log(
        `  Users: ${chunk * chunkSize}/${targetUsers} (${Math.round((chunk / totalUserChunks) * 100)}%)`,
      );
    }
  }
  insertUser.finalize();

  // 4. Generate posts in chunks
  console.log("Generating posts...");
  const insertPost = driver.prepare(`
    INSERT INTO posts (user_id, category_id, title, slug, excerpt, content, featured_image, status, metadata, seo_data, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const postTx = driver.transaction((posts: any[]) => {
    for (const post of posts) {
      insertPost.run(
        post.user_id,
        post.category_id,
        post.title,
        post.slug,
        post.excerpt,
        post.content,
        post.featured_image,
        post.status,
        post.metadata,
        post.seo_data,
        post.published_at,
        post.created_at,
        post.updated_at,
      );
    }
  });

  const totalPostChunks = Math.ceil(targetPosts / chunkSize);
  for (let chunk = 0; chunk < totalPostChunks; chunk++) {
    const posts = [];
    const currentChunkSize = Math.min(
      chunkSize,
      targetPosts - chunk * chunkSize,
    );

    for (let i = 0; i < currentChunkSize; i++) {
      const title = generator.generateTitle();
      const createdAt = generator.generateDate(2020, 2024);
      const isPublished = generator.randomInt(1, 10) > 3; // 70% published

      posts.push({
        user_id: generator.randomInt(
          1,
          Math.min(targetUsers, (chunk + 1) * chunkSize),
        ),
        category_id: generator.randomInt(1, targetCategories),
        title,
        slug: generator.generateSlug(title) + "-" + (chunk * chunkSize + i),
        excerpt: generator.generateText(20, 50),
        content: generator.generateText(100, 500),
        featured_image: `https://picsum.photos/800/600/?random=${chunk * chunkSize + i}`,
        status: isPublished
          ? generator.randomInt(1, 10) > 8
            ? "featured"
            : "published"
          : "draft",
        metadata: generator.generateJson(),
        seo_data: generator.generateJson(),
        published_at: isPublished
          ? createdAt + generator.randomInt(0, 86400000)
          : null,
        created_at: createdAt,
        updated_at: createdAt + generator.randomInt(0, now - createdAt),
      });
    }

    postTx(posts);

    if (chunk % 10 === 0) {
      console.log(
        `  Posts: ${chunk * chunkSize}/${targetPosts} (${Math.round((chunk / totalPostChunks) * 100)}%)`,
      );
    }
  }
  insertPost.finalize();

  // 5. Generate comments in chunks
  console.log("Generating comments...");
  const insertComment = driver.prepare(`
    INSERT INTO comments (post_id, user_id, parent_id, content, status, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const commentTx = driver.transaction((comments: any[]) => {
    for (const comment of comments) {
      insertComment.run(
        comment.post_id,
        comment.user_id,
        comment.parent_id,
        comment.content,
        comment.status,
        comment.metadata,
        comment.created_at,
        comment.updated_at,
      );
    }
  });

  const totalCommentChunks = Math.ceil(targetComments / chunkSize);
  for (let chunk = 0; chunk < totalCommentChunks; chunk++) {
    const comments = [];
    const currentChunkSize = Math.min(
      chunkSize,
      targetComments - chunk * chunkSize,
    );

    for (let i = 0; i < currentChunkSize; i++) {
      const createdAt = generator.generateDate(2020, 2024);
      const hasParent = generator.randomInt(1, 10) > 7; // 30% are replies

      comments.push({
        post_id: generator.randomInt(
          1,
          Math.min(
            targetPosts,
            Math.floor(
              ((chunk + 1) * chunkSize * targetPosts) / targetComments,
            ),
          ),
        ),
        user_id: generator.randomInt(
          1,
          Math.min(
            targetUsers,
            Math.floor(
              ((chunk + 1) * chunkSize * targetUsers) / targetComments,
            ),
          ),
        ),
        parent_id: hasParent
          ? generator.randomInt(1, Math.max(1, chunk * chunkSize + i))
          : null,
        content: generator.generateText(10, 80),
        status: generator.randomInt(1, 10) > 2 ? "approved" : "pending",
        metadata: generator.generateJson(),
        created_at: createdAt,
        updated_at:
          createdAt +
          generator.randomInt(0, Math.min(86400000, now - createdAt)),
      });
    }

    commentTx(comments);

    if (chunk % 10 === 0) {
      console.log(
        `  Comments: ${chunk * chunkSize}/${targetComments} (${Math.round((chunk / totalCommentChunks) * 100)}%)`,
      );
    }
  }
  insertComment.finalize();

  // 6. Generate post-tag relationships
  console.log("Generating post-tag relationships...");
  const insertPostTag = driver.prepare(`
    INSERT OR IGNORE INTO post_tags (post_id, tag_id, created_at)
    VALUES (?, ?, ?)
  `);

  const postTagTx = driver.transaction((postTags: any[]) => {
    for (const pt of postTags) {
      insertPostTag.run(pt.post_id, pt.tag_id, pt.created_at);
    }
  });

  const totalPostTagChunks = Math.ceil(targetPostTags / chunkSize);
  for (let chunk = 0; chunk < totalPostTagChunks; chunk++) {
    const postTags = [];
    const currentChunkSize = Math.min(
      chunkSize,
      targetPostTags - chunk * chunkSize,
    );

    for (let i = 0; i < currentChunkSize; i++) {
      postTags.push({
        post_id: generator.randomInt(
          1,
          Math.min(
            targetPosts,
            Math.floor(
              ((chunk + 1) * chunkSize * targetPosts) / targetPostTags,
            ),
          ),
        ),
        tag_id: generator.randomInt(1, targetTags),
        created_at: generator.generateDate(2020, 2024),
      });
    }

    postTagTx(postTags);

    if (chunk % 10 === 0) {
      console.log(
        `  Post Tags: ${chunk * chunkSize}/${targetPostTags} (${Math.round((chunk / totalPostTagChunks) * 100)}%)`,
      );
    }
  }
  insertPostTag.finalize();

  console.log("Dataset generation complete!");

  // Update counts for foreign key references
  updateGeneratedCounts({
    users: targetUsers,
    categories: targetCategories,
    tags: targetTags,
    posts: targetPosts,
    comments: targetComments,
  });
}

// Track generated counts for foreign key constraints
let generatedCounts = {
  users: 0,
  categories: 0,
  tags: 0,
  posts: 0,
  comments: 0,
};

export function updateGeneratedCounts(counts: Partial<typeof generatedCounts>) {
  generatedCounts = { ...generatedCounts, ...counts };
}

export const stressScenarios: Record<string, StressScenario> = {
  "stress-complex-joins": {
    name: "Complex JOIN Operations",
    description: "Multi-table JOINs with aggregations on large dataset",
    setup: (driver) => {
      const statements = {
        popularPosts: driver.prepare(`
          SELECT 
            p.id,
            p.title,
            u.first_name || ' ' || u.last_name as author,
            c.name as category,
            COUNT(DISTINCT co.id) as comment_count,
            COUNT(DISTINCT pt.tag_id) as tag_count,
            p.published_at,
            json_extract(p.metadata, '$.views') as views
          FROM posts p
          JOIN users u ON p.user_id = u.id
          JOIN categories c ON p.category_id = c.id
          LEFT JOIN comments co ON p.id = co.post_id AND co.status = 'approved'
          LEFT JOIN post_tags pt ON p.id = pt.post_id
          WHERE p.status = 'published'
          GROUP BY p.id
          ORDER BY comment_count DESC, views DESC
          LIMIT ?
        `),

        userStats: driver.prepare(`
          SELECT 
            u.id,
            u.first_name || ' ' || u.last_name as name,
            COUNT(DISTINCT p.id) as post_count,
            COUNT(DISTINCT co.id) as comment_count,
            AVG(json_extract(p.metadata, '$.views')) as avg_views,
            MAX(p.published_at) as last_post_date,
            json_extract(u.stats, '$.reputation') as reputation
          FROM users u
          LEFT JOIN posts p ON u.id = p.user_id AND p.status = 'published'
          LEFT JOIN comments co ON u.id = co.user_id AND co.status = 'approved'
          GROUP BY u.id
          HAVING post_count > 0
          ORDER BY post_count DESC, avg_views DESC
          LIMIT ?
        `),

        categoryBreakdown: driver.prepare(`
          SELECT 
            c.name,
            c.description,
            COUNT(p.id) as post_count,
            COUNT(DISTINCT p.user_id) as author_count,
            AVG(comment_counts.cnt) as avg_comments_per_post,
            MAX(p.published_at) as latest_post
          FROM categories c
          LEFT JOIN posts p ON c.id = p.category_id AND p.status IN ('published', 'featured')
          LEFT JOIN (
            SELECT post_id, COUNT(*) as cnt 
            FROM comments 
            WHERE status = 'approved' 
            GROUP BY post_id
          ) comment_counts ON p.id = comment_counts.post_id
          GROUP BY c.id
          ORDER BY post_count DESC
        `),
      };

      return {
        statements,
        cleanup: () => {
          Object.values(statements).forEach((stmt) => stmt.finalize());
        },
      };
    },
    run: (context, iteration) => {
      const limit = 50 + ((iteration ?? 0) % 50); // Vary result size
      const scenario = (iteration ?? 0) % 3;

      switch (scenario) {
        case 0:
          return context.statements.popularPosts.all(limit);
        case 1:
          return context.statements.userStats.all(limit);
        case 2:
          return context.statements.categoryBreakdown.all();
        default:
          return context.statements.popularPosts.all(limit);
      }
    },
    iterations: 100,
  },

  "stress-fts-search": {
    name: "Full-Text Search Performance",
    description: "FTS5 searches across large content dataset",
    setup: (driver) => {
      const statements = {
        contentSearch: driver.prepare(`
          SELECT 
            p.id,
            p.title,
            p.excerpt,
            snippet(posts_fts, 2, '<mark>', '</mark>', '...', 50) as snippet,
            bm25(posts_fts) as relevance_score
          FROM posts_fts
          JOIN posts p ON posts_fts.rowid = p.id
          WHERE posts_fts MATCH ?
          AND p.status = 'published'
          ORDER BY rank
          LIMIT ?
        `),

        titleSearch: driver.prepare(`
          SELECT 
            p.id,
            p.title,
            p.excerpt,
            u.first_name || ' ' || u.last_name as author,
            c.name as category,
            p.published_at
          FROM posts_fts
          JOIN posts p ON posts_fts.rowid = p.id
          JOIN users u ON p.user_id = u.id
          JOIN categories c ON p.category_id = c.id
          WHERE posts_fts MATCH 'title:' || ?
          AND p.status = 'published'
          ORDER BY rank
          LIMIT ?
        `),

        phraseSearch: driver.prepare(`
          SELECT 
            p.id,
            p.title,
            snippet(posts_fts, 1, '<b>', '</b>', '...', 100) as title_snippet,
            snippet(posts_fts, 2, '<em>', '</em>', '...', 200) as content_snippet,
            bm25(posts_fts) as score
          FROM posts_fts
          JOIN posts p ON posts_fts.rowid = p.id
          WHERE posts_fts MATCH '"' || ? || '"'
          AND p.status IN ('published', 'featured')
          ORDER BY bm25(posts_fts)
          LIMIT ?
        `),
      };

      return {
        statements,
        cleanup: () => {
          Object.values(statements).forEach((stmt) => stmt.finalize());
        },
      };
    },
    run: (context, iteration) => {
      const searchTerms = [
        "technology development",
        "software programming",
        "database performance",
        "web application",
        "user interface",
        "system architecture",
        "best practices",
        "optimization scalability",
        "framework library",
        "implementation solution",
      ];

      const phrases = [
        "best practices",
        "performance optimization",
        "software development",
        "user experience",
        "system design",
        "database management",
      ];

      const limit = 20 + ((iteration ?? 0) % 30);
      const scenario = (iteration ?? 0) % 3;
      const term = searchTerms[(iteration ?? 0) % searchTerms.length];
      const phrase = phrases[(iteration ?? 0) % phrases.length];

      switch (scenario) {
        case 0:
          return context.statements.contentSearch.all(term, limit);
        case 1:
          return context.statements.titleSearch.all(term.split(" ")[0], limit);
        case 2:
          return context.statements.phraseSearch.all(phrase, limit);
        default:
          return context.statements.contentSearch.all(term, limit);
      }
    },
    iterations: 100,
  },

  "stress-bulk-operations": {
    name: "Bulk Operations with Constraints",
    description: "Large transactions with foreign key constraints",
    setup: (driver) => {
      const statements = {
        insertPost: driver.prepare(`
          INSERT INTO posts (user_id, category_id, title, slug, excerpt, content, status, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),

        insertComments: driver.prepare(`
          INSERT INTO comments (post_id, user_id, content, status, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `),

        updatePostStats: driver.prepare(`
          UPDATE posts 
          SET metadata = json_set(
            COALESCE(metadata, '{}'),
            '$.views', COALESCE(json_extract(metadata, '$.views'), 0) + ?,
            '$.last_viewed', ?
          )
          WHERE id = ?
        `),

        bulkTagging: driver.prepare(`
          INSERT OR IGNORE INTO post_tags (post_id, tag_id, created_at)
          VALUES (?, ?, ?)
        `),
      };

      const bulkInsertTx = driver.transaction(
        (posts: any[], comments: any[]) => {
          for (const post of posts) {
            const result = statements.insertPost.run(
              post.user_id,
              post.category_id,
              post.title,
              post.slug,
              post.excerpt,
              post.content,
              post.status,
              post.metadata,
              post.created_at,
              post.updated_at,
            );

            // Add comments for this post
            const postComments = comments.filter(
              (c) => c.post_id === post.temp_id,
            );
            for (const comment of postComments) {
              statements.insertComments.run(
                result.lastInsertRowid,
                comment.user_id,
                comment.content,
                comment.status,
                comment.metadata,
                comment.created_at,
                comment.updated_at,
              );
            }
          }
          return posts.length;
        },
      );

      const bulkUpdateTx = driver.transaction((updates: any[]) => {
        for (const update of updates) {
          statements.updatePostStats.run(
            update.views,
            update.timestamp,
            update.post_id,
          );
        }
        return updates.length;
      });

      return {
        statements,
        bulkInsertTx,
        bulkUpdateTx,
        cleanup: () => {
          Object.values(statements).forEach((stmt) => {
            if (typeof stmt.finalize === "function") stmt.finalize();
          });
        },
      };
    },
    run: (context, iteration) => {
      const generator = new NaturalDataGenerator(12345 + (iteration ?? 0));
      const now = Date.now();
      const scenario = (iteration ?? 0) % 3;

      switch (scenario) {
        case 0: {
          // Bulk insert posts with comments
          const batchSize = 50;
          const posts = [];
          const comments = [];

          for (let i = 0; i < batchSize; i++) {
            const tempId = i;
            const title = generator.generateTitle();
            posts.push({
              temp_id: tempId,
              user_id: generator.randomInt(
                1,
                Math.max(1, generatedCounts.users),
              ),
              category_id: generator.randomInt(
                1,
                Math.max(1, generatedCounts.categories),
              ),
              title,
              slug: generator.generateSlug(title) + "-" + now + "-" + i,
              excerpt: generator.generateText(10, 30),
              content: generator.generateText(50, 200),
              status: "published",
              metadata: generator.generateJson(),
              created_at: now,
              updated_at: now,
            });

            // 1-5 comments per post
            const commentCount = generator.randomInt(1, 5);
            for (let j = 0; j < commentCount; j++) {
              comments.push({
                post_id: tempId,
                user_id: generator.randomInt(
                  1,
                  Math.max(1, generatedCounts.users),
                ),
                content: generator.generateText(5, 50),
                status: "approved",
                metadata: generator.generateJson(),
                created_at: now + j * 1000,
                updated_at: now + j * 1000,
              });
            }
          }

          return (context as any).bulkInsertTx(posts, comments);
        }

        case 1: {
          // Bulk update post statistics
          const updateCount = 100;
          const updates = [];

          for (let i = 0; i < updateCount; i++) {
            updates.push({
              post_id: generator.randomInt(
                1,
                Math.max(1, generatedCounts.posts),
              ),
              views: generator.randomInt(1, 100),
              timestamp: now,
            });
          }

          return (context as any).bulkUpdateTx(updates);
        }

        case 2: {
          // Bulk tag assignments
          const assignmentCount = 200;
          for (let i = 0; i < assignmentCount; i++) {
            context.statements.bulkTagging.run(
              generator.randomInt(1, Math.max(1, generatedCounts.posts)),
              generator.randomInt(1, Math.max(1, generatedCounts.tags)),
              now,
            );
          }
          return assignmentCount;
        }

        default:
          return 0;
      }
    },
    iterations: 50,
  },

  "stress-concurrent-reads": {
    name: "Concurrent Read Operations",
    description: "Simulate multiple concurrent read patterns",
    setup: (driver) => {
      const statements = {
        randomPost: driver.prepare(`
          SELECT p.*, u.first_name || ' ' || u.last_name as author, c.name as category
          FROM posts p
          JOIN users u ON p.user_id = u.id
          JOIN categories c ON p.category_id = c.id
          WHERE p.id = ?
        `),

        recentPosts: driver.prepare(`
          SELECT p.id, p.title, p.excerpt, p.published_at
          FROM posts p
          WHERE p.status = 'published' AND p.published_at > ?
          ORDER BY p.published_at DESC
          LIMIT ?
        `),

        postWithComments: driver.prepare(`
          SELECT 
            p.id, p.title, p.content,
            COUNT(c.id) as comment_count,
            GROUP_CONCAT(t.name) as tags
          FROM posts p
          LEFT JOIN comments c ON p.id = c.post_id AND c.status = 'approved'
          LEFT JOIN post_tags pt ON p.id = pt.post_id
          LEFT JOIN tags t ON pt.tag_id = t.id
          WHERE p.id = ?
          GROUP BY p.id
        `),

        userProfile: driver.prepare(`
          SELECT 
            u.*,
            COUNT(DISTINCT p.id) as post_count,
            COUNT(DISTINCT c.id) as comment_count,
            MAX(p.published_at) as last_post
          FROM users u
          LEFT JOIN posts p ON u.id = p.user_id AND p.status = 'published'
          LEFT JOIN comments c ON u.id = c.user_id AND c.status = 'approved'
          WHERE u.id = ?
          GROUP BY u.id
        `),
      };

      return {
        statements,
        cleanup: () => {
          Object.values(statements).forEach((stmt) => stmt.finalize());
        },
      };
    },
    run: (context, iteration) => {
      const generator = new NaturalDataGenerator(12345 + (iteration ?? 0));
      const scenario = (iteration ?? 0) % 4;

      switch (scenario) {
        case 0:
          return context.statements.randomPost.get(
            generator.randomInt(1, Math.max(1, generatedCounts.posts)),
          );
        case 1:
          return context.statements.recentPosts.all(
            Date.now() - 30 * 24 * 60 * 60 * 1000, // Last 30 days
            generator.randomInt(10, 50),
          );
        case 2:
          return context.statements.postWithComments.get(
            generator.randomInt(1, Math.max(1, generatedCounts.posts)),
          );
        case 3:
          return context.statements.userProfile.get(
            generator.randomInt(1, Math.max(1, generatedCounts.users)),
          );
        default:
          return null;
      }
    },
    iterations: 200,
  },
};

// Helper to get stress scenarios by name or pattern
export function getStressScenarios(
  filter?: string | null,
): Array<[string, StressScenario]> {
  if (!filter) {
    return Object.entries(stressScenarios);
  }

  const pattern = filter.toLowerCase();
  return Object.entries(stressScenarios).filter(
    ([key, scenario]) =>
      key.toLowerCase().includes(pattern) ||
      scenario.name.toLowerCase().includes(pattern),
  );
}
