import React, { useRef, useEffect } from 'react';
import { ScrollView, ScrollViewProps, Platform } from 'react-native';

interface HorizontalScrollProps extends ScrollViewProps {
  children: React.ReactNode;
}

/**
 * A wrapper for ScrollView that enables intuitive horizontal scrolling with the mouse wheel on desktop/web.
 * Also automatically shows scroll indicators on web for better accessibility.
 */
export default function HorizontalScroll({ children, ...props }: HorizontalScrollProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    
    const scrollView = scrollRef.current;
    if (!scrollView) return;

    // Access the underlying DOM node
    // React Native Web ScrollView uses an internal view for scrolling
    const node = (scrollView as any).getScrollableNode?.() || (scrollView as any)._outerView || scrollView;
    
    if (!node || !node.addEventListener) return;

    const handleWheel = (e: WheelEvent) => {
      // If the scroll is predominantly vertical, we check if we should hijack it for horizontal movement
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // SMART SCROLL: If the user is hovering over an element that specifically needs vertical scrolling
        // (like a task column or a detail drawer), we let the event pass through naturally.
        const target = e.target as HTMLElement;
        const isVerticalZone = target.closest('[data-vertical-scroll="true"]');
        
        if (isVerticalZone) {
          return; // Let the browser handle vertical scroll for this column/drawer
        }

        // Otherwise, if we're on the board background, convert vertical wheel to horizontal scroll
        e.preventDefault();
        (node as HTMLElement).scrollLeft += e.deltaY;
      }
    };

    node.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      node.removeEventListener('wheel', handleWheel);
    };
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={Platform.OS === 'web' ? true : (props.showsHorizontalScrollIndicator ?? false)}
      {...props}
    >
      {children}
    </ScrollView>
  );
}
