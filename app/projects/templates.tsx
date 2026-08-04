import { Stack } from 'expo-router';
import React from 'react';

import TemplatesLibrary from '@/components/templates/TemplatesLibrary';

// /projects/templates — the library for the editor that shipped in #177.
//
// A route rather than another sheet on the Projects screen, for the reason
// #184 moved project detail out of a Popup: this is a place you go and stay,
// you link people to it, and you come back to it. A modal cannot be any of
// those. It sits under /projects because a template only means anything in
// terms of projects — it is the pattern they are cut from.
//
// ONE file, no .web.tsx split: TemplatesLibrary already branches its layout on
// useWindowDimensions and there is no desktop-only affordance here that a
// mobile paradigm has to replace (same call as app/projects/[id].tsx).
export default function TemplatesScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TemplatesLibrary />
    </>
  );
}
