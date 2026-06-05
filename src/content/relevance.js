/**
 * FocusTube — Keyword-based Relevance Scoring
 * Determines whether a destination video is related to the current study topic.
 * No AI required — uses tokenization and Jaccard-like similarity.
 */

const FocusTubeRelevance = (() => {

  // Stop words to ignore during keyword extraction
  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'are', 'was',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
    'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
    'just', 'about', 'above', 'after', 'again', 'all', 'also', 'am',
    'any', 'as', 'because', 'before', 'between', 'both', 'each', 'few',
    'get', 'got', 'here', 'how', 'i', 'into', 'its', 'let', 'like',
    'make', 'me', 'more', 'most', 'much', 'my', 'now', 'only',
    'other', 'our', 'out', 'own', 'same', 'she', 'he', 'some', 'such',
    'take', 'their', 'them', 'these', 'they', 'those', 'through', 'under',
    'until', 'up', 'us', 'want', 'we', 'what', 'when', 'where', 'which',
    'while', 'who', 'whom', 'why', 'you', 'your',
    // YouTube-specific noise
    'video', 'tutorial', 'lecture', 'part', 'episode', 'ep', 'full',
    'course', 'class', 'lesson', 'chapter', 'series', 'complete',
    'beginner', 'advanced', 'intermediate', 'introduction', 'intro',
    'hindi', 'english', 'explained', 'explanation', 'learn', 'learning',
    'guide', 'tips', 'tricks', 'easy', 'simple', 'best', 'top',
    'new', 'latest', 'updated', '2024', '2025', '2026',
  ]);

  // Technology-related synonym/alias groups
  const TECH_ALIASES = [
    ['javascript', 'js', 'es6', 'es2015', 'ecmascript'],
    ['typescript', 'ts'],
    ['react', 'reactjs', 'react.js'],
    ['vue', 'vuejs', 'vue.js'],
    ['angular', 'angularjs'],
    ['node', 'nodejs', 'node.js'],
    ['python', 'py'],
    ['cpp', 'c++'],
    ['csharp', 'c#'],
    ['dp', 'dynamic programming'],
    ['dsa', 'data structures', 'algorithms'],
    ['ml', 'machine learning'],
    ['ai', 'artificial intelligence'],
    ['dl', 'deep learning'],
    ['css', 'stylesheet', 'styling'],
    ['html', 'markup'],
    ['sql', 'mysql', 'postgresql', 'postgres'],
    ['mongodb', 'mongo'],
    ['aws', 'amazon web services'],
    ['gcp', 'google cloud'],
    ['devops', 'ci/cd', 'cicd'],
    ['oop', 'object oriented'],
    ['api', 'rest', 'restful'],
    ['os', 'operating system', 'operating systems'],
  ];

  /**
   * Extract meaningful keywords from a text string.
   */
  function extractKeywords(text) {
    if (!text) return [];

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s\+\#\.\/]/g, ' ')
      .split(/\s+/)
      .map(w => w.replace(/^[.\-]+|[.\-]+$/g, ''))
      .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  }

  /**
   * Expand keywords with known aliases.
   */
  function expandWithAliases(keywords) {
    const expanded = new Set(keywords);

    for (const keyword of keywords) {
      for (const group of TECH_ALIASES) {
        if (group.includes(keyword)) {
          group.forEach(alias => expanded.add(alias));
        }
      }
    }

    return expanded;
  }

  /**
   * Compute relevance score between two sets of keywords.
   * Returns a value between 0 and 1.
   */
  function computeSimilarity(sourceKeywords, destKeywords) {
    if (sourceKeywords.size === 0 || destKeywords.size === 0) return 0;

    let matchCount = 0;
    for (const word of destKeywords) {
      if (sourceKeywords.has(word)) {
        matchCount++;
      }
    }

    // Jaccard-like: intersection / min(source, dest)
    // We use min instead of union to be more lenient
    const denominator = Math.min(sourceKeywords.size, destKeywords.size);
    if (denominator === 0) return 0;

    return matchCount / denominator;
  }

  /**
   * Check relevance of a destination video against the current study topic.
   * @param {string} currentTitle - Title of the current lecture
   * @param {string} destinationTitle - Title of the destination video
   * @param {string[]} sessionKeywords - Pre-extracted keywords from session start
   * @returns {{ verdict: string, score: number, sourceKeywords: string[], destKeywords: string[] }}
   */
  function checkRelevance(currentTitle, destinationTitle, sessionKeywords = []) {
    const sourceRaw = extractKeywords(currentTitle);
    const destRaw = extractKeywords(destinationTitle);

    // Merge session keywords with current title keywords
    const combinedSource = [...new Set([...sourceRaw, ...sessionKeywords])];

    const sourceExpanded = expandWithAliases(combinedSource);
    const destExpanded = expandWithAliases(destRaw);

    const score = computeSimilarity(sourceExpanded, destExpanded);

    let verdict;
    if (score >= 0.3) {
      verdict = 'RELATED';
    } else if (score >= 0.1) {
      verdict = 'PARTIALLY_RELATED';
    } else {
      verdict = 'UNRELATED';
    }

    return {
      verdict,
      score: Math.round(score * 100) / 100,
      sourceKeywords: [...sourceExpanded],
      destKeywords: [...destExpanded],
    };
  }

  // Expose globally for content scripts (non-module)
  return { checkRelevance, extractKeywords };

})();

// Make available globally since content scripts can't use ES modules
window.FocusTubeRelevance = FocusTubeRelevance;
