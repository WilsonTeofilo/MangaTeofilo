import React from 'react';
import { Helmet } from 'react-helmet-async';
import { ogImageMimeHint } from '../../../components/ChapterShareBar.jsx';

export default function ChapterSeo({ chapterSeo, noIndex = false, includeJsonLd = true }) {
  if (!chapterSeo) return null;
  return (
    <Helmet prioritizeSeoTags>
      <title>{chapterSeo.title}</title>
      <meta name="description" content={chapterSeo.description} />
      <meta property="og:type" content="article" />
      <meta property="og:title" content={chapterSeo.title} />
      <meta property="og:description" content={chapterSeo.description} />
      <meta property="og:url" content={chapterSeo.canonical} />
      <meta property="og:image" content={chapterSeo.shareImage} />
      {/^https:\/\//i.test(chapterSeo.shareImage) ? (
        <meta property="og:image:secure_url" content={chapterSeo.shareImage} />
      ) : null}
      <meta property="og:image:type" content={ogImageMimeHint(chapterSeo.shareImage)} />
      <meta property="og:image:alt" content={chapterSeo.imageAlt} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={chapterSeo.title} />
      <meta name="twitter:description" content={chapterSeo.description} />
      <meta name="twitter:image" content={chapterSeo.shareImage} />
      <meta name="twitter:image:alt" content={chapterSeo.imageAlt} />
      <link rel="canonical" href={chapterSeo.canonical} />
      {includeJsonLd ? (
        <script type="application/ld+json">{JSON.stringify(chapterSeo.jsonLd)}</script>
      ) : null}
      {noIndex ? <meta name="robots" content="noindex,follow" /> : null}
    </Helmet>
  );
}
