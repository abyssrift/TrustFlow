import React from 'react';
import { View } from 'react-native';
import Popup from '@/components/common/Popup';
import ReportGeneratorDesktop from './_ReportGenerator_desktop';

interface ReportGeneratorPopupProps {
  visible: boolean;
  onClose: () => void;
  onReportGenerated: () => void;
}

export default function ReportGeneratorPopup({ visible, onClose, onReportGenerated }: ReportGeneratorPopupProps) {
  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="centered"
      maxWidth={1200}
      dismissible={true}
      containerClassName="overflow-hidden"
      containerStyle={{ borderRadius: 24 }}
    >
      <View className="flex-1">
        <ReportGeneratorDesktop onReportGenerated={onReportGenerated} />
      </View>
    </Popup>
  );
}