/**
 * Shared utilities for GitHub API interactions
 */

import * as https from "node:https";

/**
 * GitHub API rate limit information
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

/**
 * Fetch options for GitHub API requests
 */
export interface GitHubFetchOptions {
  headers?: Record<string, string>;
  logRateLimit?: boolean;
}

/**
 * Make an authenticated fetch request to the GitHub API
 * Automatically adds authentication token if GITHUB_TOKEN is set
 *
 * @param url - The URL to fetch
 * @param options - Additional fetch options
 * @returns The fetch response
 */
export async function githubFetch(
  url: string,
  options: GitHubFetchOptions = {},
): Promise<Response> {
  const { headers = {}, logRateLimit = true } = options;

  // Prepare headers with GitHub authentication if available
  // See: https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api
  const authHeaders: HeadersInit = { ...headers };
  const githubToken = process.env.GITHUB_TOKEN;

  if (githubToken) {
    authHeaders["Authorization"] = `Bearer ${githubToken}`;
    if (logRateLimit) {
      console.log("Using GitHub authentication token");
    }
  } else if (logRateLimit) {
    console.warn(
      "No GITHUB_TOKEN found - API requests will be rate limited to 60/hour",
    );
  }

  const response = await fetch(url, { headers: authHeaders });

  // Log rate limit information
  if (logRateLimit && url.includes("api.github.com")) {
    const rateLimitInfo = extractRateLimitInfo(response.headers);
    if (rateLimitInfo) {
      logRateLimitInfo(rateLimitInfo);
    }
  }

  // Handle rate limit errors
  if (response.status === 403 || response.status === 429) {
    console.error("GitHub API rate limit exceeded!");
    if (!githubToken) {
      console.error(
        "Set GITHUB_TOKEN environment variable to increase rate limits",
      );
    }
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    );
  }

  return response;
}

/**
 * Fetch a URL using Node.js https module with GitHub authentication
 * This is for compatibility with existing code that uses the https module
 *
 * @param url - The URL to fetch
 * @param headers - Additional headers to include
 * @returns The response body as a string
 */
export async function githubFetchUrl(
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Prepare headers with GitHub authentication if available
    // See: https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api
    const authHeaders: Record<string, string> = {
      "User-Agent": "node-sqlite-sync-script",
      ...headers,
    };

    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      authHeaders["Authorization"] = `Bearer ${githubToken}`;
      console.log("Using GitHub authentication token");
    } else {
      console.warn(
        "No GITHUB_TOKEN found - API requests will be rate limited to 60/hour",
      );
    }

    const options = { headers: authHeaders };

    https
      .get(url, options, (res) => {
        // Log rate limit information for GitHub API calls
        if (url.includes("api.github.com")) {
          const rateLimitInfo = extractRateLimitInfoFromHeaders(res.headers);
          if (rateLimitInfo) {
            logRateLimitInfo(rateLimitInfo);
          }
        }

        if (res.statusCode !== 200) {
          const isRateLimit = res.statusCode === 403 || res.statusCode === 429;
          if (isRateLimit && url.includes("api.github.com")) {
            console.error("GitHub API rate limit exceeded!");
            if (!process.env.GITHUB_TOKEN) {
              console.error(
                "Set GITHUB_TOKEN environment variable to increase rate limits",
              );
            }
          }
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

/**
 * Extract rate limit information from fetch Headers
 */
function extractRateLimitInfo(headers: Headers): RateLimitInfo | null {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");

  if (limit && remaining && reset) {
    return {
      limit: parseInt(limit),
      remaining: parseInt(remaining),
      reset: new Date(parseInt(reset) * 1000),
    };
  }

  return null;
}

/**
 * Extract rate limit information from Node.js http headers
 */
function extractRateLimitInfoFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RateLimitInfo | null {
  const limit = headers["x-ratelimit-limit"];
  const remaining = headers["x-ratelimit-remaining"];
  const reset = headers["x-ratelimit-reset"];

  if (limit && remaining && reset) {
    return {
      limit: parseInt(String(limit)),
      remaining: parseInt(String(remaining)),
      reset: new Date(parseInt(String(reset)) * 1000),
    };
  }

  return null;
}

/**
 * Log rate limit information to console
 */
function logRateLimitInfo(info: RateLimitInfo): void {
  console.log(
    `GitHub API rate limit: ${info.remaining}/${info.limit} remaining`,
  );
  console.log(`Rate limit resets at: ${info.reset.toLocaleString()}`);
}
