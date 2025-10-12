/**
 * Utility functions for URL-based search functionality
 */

export function buildSearchUrl(baseUrl: string, params: {
  search?: string;
  site?: string;
  refine?: string;
}): string {
  const urlParams = new URLSearchParams();
  
  if (params.search?.trim()) {
    urlParams.set('search', params.search.trim());
  }
  
  if (params.site && params.site !== 'all') {
    urlParams.set('site', params.site);
  }
  
  if (params.refine?.trim()) {
    urlParams.set('refine', params.refine.trim());
  }
  
  const queryString = urlParams.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

export function parseSearchParams(searchParams: URLSearchParams) {
  return {
    search: searchParams.get('search') || '',
    site: searchParams.get('site') || 'all',
    refine: searchParams.get('refine') || ''
  };
}