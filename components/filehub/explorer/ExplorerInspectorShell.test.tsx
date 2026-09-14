import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let viewportWidth = 1280;

vi.mock('react-native', () => ({
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  useWindowDimensions: () => ({ width: viewportWidth, height: 800 }),
}));

import ExplorerInspectorShell from './ExplorerInspectorShell';

const slot = (label: string) => <Text>{label}</Text>;

describe('ExplorerInspectorShell', () => {
  beforeEach(() => {
    viewportWidth = 1280;
  });

  it('renders collection-only content with bounded collection placement', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ExplorerInspectorShell
          collection={slot('collection')}
          mobilePane="collection"
          onRequestCollection={vi.fn()}
        />,
      );
    });

    expect(renderer!.root.findByProps({ testID: 'explorer-inspector-shell' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'explorer-collection-pane' })).toBeTruthy();
    expect(renderer!.root.findAllByProps({ testID: 'explorer-inspector-pane' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ testID: 'explorer-mobile-back' })).toHaveLength(0);
  });

  it('places optional navigation and header slots above the panes', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ExplorerInspectorShell
          navigation={slot('navigation')}
          header={slot('header')}
          collection={slot('collection')}
          inspector={slot('inspector')}
          mobilePane="collection"
          onRequestCollection={vi.fn()}
        />,
      );
    });

    expect(renderer!.root.findByProps({ testID: 'explorer-navigation' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'explorer-header' })).toBeTruthy();
    expect(renderer!.root.findAllByType('Text').map((node) => node.props.children)).toEqual([
      'navigation',
      'header',
      'collection',
      'inspector',
    ]);
  });

  it('splits collection and inspector on desktop with a bounded custom-width inspector', () => {
    viewportWidth = 1280;
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ExplorerInspectorShell
          collection={slot('collection')}
          inspector={slot('inspector')}
          mobilePane="collection"
          onRequestCollection={vi.fn()}
          inspectorWidth={420}
        />,
      );
    });

    const root = renderer!.root.findByProps({ testID: 'explorer-inspector-shell' });
    const collectionPane = renderer!.root.findByProps({ testID: 'explorer-collection-pane' });
    const inspectorPane = renderer!.root.findByProps({ testID: 'explorer-inspector-pane' });
    expect(root.props.className).toContain('overflow-hidden');
    expect(collectionPane.props.className).toContain('min-w-0');
    expect(inspectorPane.props.style).toMatchObject({ width: 420, flexShrink: 0 });
  });

  it('does not render an empty inspector pane when inspector is missing', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ExplorerInspectorShell
          collection={slot('collection')}
          mobilePane="inspector"
          onRequestCollection={vi.fn()}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({ testID: 'explorer-inspector-pane' })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ testID: 'explorer-mobile-back' })).toHaveLength(0);
  });

  it('shows the controlled mobile inspector and invokes the collection back affordance', () => {
    viewportWidth = 390;
    const onRequestCollection = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ExplorerInspectorShell
          collection={slot('collection')}
          inspector={slot('inspector')}
          mobilePane="inspector"
          onRequestCollection={onRequestCollection}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({ testID: 'explorer-collection-pane' })).toHaveLength(0);
    const back = renderer!.root.findByProps({ testID: 'explorer-mobile-back' });
    act(() => back.props.onPress());
    expect(onRequestCollection).toHaveBeenCalledOnce();
  });

  it('shows the controlled mobile collection without a back affordance', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ExplorerInspectorShell
          collection={slot('collection')}
          inspector={slot('inspector')}
          mobilePane="collection"
          onRequestCollection={vi.fn()}
        />,
      );
    });

    expect(renderer!.root.findByProps({ testID: 'explorer-collection-pane' })).toBeTruthy();
    expect(renderer!.root.findAllByProps({ testID: 'explorer-mobile-back' })).toHaveLength(0);
  });
});
