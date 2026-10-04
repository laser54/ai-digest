import { publicationDate } from './digest-result.js';
import { fetchHtml } from './article-fetcher.js';
import * as cheerio from 'cheerio';

export const IMPLEMENTATION_PROMPT_PATTERN = /внедр|пилот|эксплуатац|запуск|интеграц|использован|фактическ|implemented|deployment|pilot|production use/i;

export function requiresImplementationEvidence(editorialPrompt = '') {
  return IMPLEMENTATION_PROMPT_PATTERN.test(String(editorialPrompt));
}

const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
const canonicalUrl = (value) => { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return ''; } };

export function verifyFetchedEvidence(article, page) {
  const evidence = article?.evidence && typeof article.evidence === 'object' ? article.evidence : {};
  const sourceText = normalize(page?.text);
  const quote = String(evidence.quote || '').replace(/\s+/g, ' ').trim();
  const excerptMatches = quote.length >= 30 && sourceText.includes(normalize(quote));
  const urlMatches = canonicalUrl(article?.url) && canonicalUrl(article.url) === canonicalUrl(page?.url);
  const date = publicationDate(page?.publishedAt);
  const dateMatches = date && (!article.publishedAt || date === publicationDate(article.publishedAt));
  const organization = String(evidence.organization || '').trim();
  const technology = String(evidence.technology || '').trim();
  const implementation = String(evidence.implementation || '').trim();
  const claimsMatch = [organization, technology, implementation].every((claim) => claim.length >= 2 && sourceText.includes(normalize(claim)));
  const stage = /план|намерен|объявил|announc|plan/i.test(quote) ? 'announcement'
    : /пилот|pilot|тестир|testing/i.test(quote) ? 'pilot'
      : /эксплуатац|запущен|использует|production|deployed|in use/i.test(quote) ? 'operation' : 'unconfirmed';
  const fetched = page?.status === 'fetched' && Boolean(urlMatches);
  const verified = Boolean(fetched && excerptMatches && dateMatches && claimsMatch && stage !== 'unconfirmed');
  return {
    verification: verified ? 'fetched_verified' : fetched && evidence ? 'search_evidence_only' : 'unverified',
    evidence: {
      organization: organization || null,
      technology: technology || null,
      implementation: implementation || null,
      stage,
      excerpt: verified ? quote : null,
      url: fetched ? page.url : null,
      publishedAt: verified ? date : null,
      dateProvenance: verified ? 'fetched_article_metadata_utc' : null
    },
    autoEligible: verified && stage !== 'announcement'
  };
}

export async function fetchArticleEvidence(article, fetcher = fetchHtml) {
  try {
    const page = await fetcher(article.url);
    const $ = cheerio.load(page.html);
    const articleRoot = $('article').first();
    const root = articleRoot.length ? articleRoot : $('main').first();
    const articleDateMetadata = $('time[datetime]').length > 0 || Boolean($('meta[property="article:published_time"]').attr('content'));
    if (!root.length || (!articleRoot.length && !articleDateMetadata)) {
      return { ...verifyFetchedEvidence(article, { status: 'listing', url: page.url, text: '', publishedAt: null }), fetchStatus: 'listing' };
    }
    const text = root.text().replace(/\s+/g, ' ').trim();
    const publishedAt = root.find('time[datetime]').first().attr('datetime')
      || $('meta[property="article:published_time"]').attr('content') || null;
    return { ...verifyFetchedEvidence(article, { status: 'fetched', url: page.url, text, publishedAt }), fetchStatus: 'fetched' };
  } catch (error) {
    return { verification: 'unverified', evidence: null, autoEligible: false, fetchStatus: error?.status || 'http_error' };
  }
}
