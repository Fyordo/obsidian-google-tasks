import { requestUrl } from "obsidian";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REDIRECT_URI = "http://127.0.0.1";
const SCOPES = "https://www.googleapis.com/auth/tasks.readonly";

export interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  /** Timestamp (ms) when the access token expires */
  expires_at: number;
}

export class GoogleAuth {
  private clientId: string;
  private clientSecret: string;
  private tokens: TokenData | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /* ---- credentials hot-swap ---- */

  updateCredentials(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /* ---- auth URL ---- */

  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /* ---- code → tokens ---- */

  async exchangeCode(code: string): Promise<TokenData> {
    const resp = await requestUrl({
      url: GOOGLE_TOKEN_URL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
    });

    const data = resp.json;

    if (data.error) {
      throw new Error(`Google token error: ${data.error_description ?? data.error}`);
    }

    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    return this.tokens;
  }

  /* ---- refresh ---- */

  async refreshAccessToken(): Promise<TokenData> {
    if (!this.tokens?.refresh_token) {
      throw new Error("No refresh token available. Please re-authorize.");
    }

    const resp = await requestUrl({
      url: GOOGLE_TOKEN_URL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: this.tokens.refresh_token,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    });

    const data = resp.json;

    if (data.error) {
      throw new Error(`Google refresh error: ${data.error_description ?? data.error}`);
    }

    this.tokens = {
      ...this.tokens,
      access_token: data.access_token,
      expires_in: data.expires_in,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    return this.tokens;
  }

  /* ---- get a valid access token (auto-refresh) ---- */

  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error("Not authenticated. Open plugin settings and sign in.");
    }
    // refresh 60 s before expiry
    if (Date.now() >= this.tokens.expires_at - 60_000) {
      await this.refreshAccessToken();
    }
    return this.tokens.access_token;
  }

  /* ---- helpers ---- */

  setTokens(tokens: TokenData | null) {
    this.tokens = tokens;
  }

  getTokens(): TokenData | null {
    return this.tokens;
  }

  isAuthenticated(): boolean {
    return this.tokens !== null && !!this.tokens.refresh_token;
  }

  /**
   * Parse the redirect URL that the user copies from the browser
   * and return the authorization code.
   */
  static extractCodeFromRedirectUrl(url: string): string {
    // The URL looks like: http://127.0.0.1/?code=4/0A...&scope=...
    // or the user might just paste the code itself
    try {
      const parsed = new URL(url);
      const code = parsed.searchParams.get("code");
      if (code) return code;
    } catch {
      // not a valid URL — treat the whole string as the code
    }
    return url.trim();
  }
}
