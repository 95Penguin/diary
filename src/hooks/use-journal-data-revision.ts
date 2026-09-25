import { useEffect, useState } from 'react';

import { subscribeToJournalDataChanges, type JournalDataDomain } from '@/utils/journal-data-events';

export function useJournalDataRevision(domains: readonly JournalDataDomain[]) {
  const [revision, setRevision] = useState(0);
  const domainKey = [...domains].sort().join('|');

  useEffect(() => {
    const watched = new Set(domainKey.split('|').filter(Boolean) as JournalDataDomain[]);
    return subscribeToJournalDataChanges((changed) => {
      if ([...changed].some((domain) => watched.has(domain))) setRevision((value) => value + 1);
    });
  }, [domainKey]);

  return revision;
}
