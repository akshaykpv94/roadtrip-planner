import React from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ViewStyle } from 'react-native';
import { c, r, s } from './theme';

export const Screen = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) =>
  <View style={[{ flex: 1, backgroundColor: c.paper, padding: s.lg }, style]}>{children}</View>;

export const H = ({ children }: { children: React.ReactNode }) =>
  <Text style={{ fontSize: 22, fontWeight: '700', color: c.text, marginBottom: s.sm }}>{children}</Text>;

export const Muted = ({ children }: { children: React.ReactNode }) =>
  <Text style={{ fontSize: 13, color: c.muted }}>{children}</Text>;

export const Card = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
  <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : undefined}
    style={{ backgroundColor: '#fff', borderRadius: r.md, borderWidth: 1, borderColor: c.line, padding: s.md, marginBottom: s.sm }}>
    {children}
  </Pressable>;

export const Button = ({ label, onPress, kind = 'primary' }: { label: string; onPress: () => void; kind?: 'primary' | 'ghost' }) =>
  <Pressable onPress={onPress} accessibilityRole="button" style={{
    minHeight: 48, borderRadius: r.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: s.lg,
    backgroundColor: kind === 'primary' ? c.board : 'transparent', borderWidth: kind === 'ghost' ? 1 : 0, borderColor: c.board }}>
    <Text style={{ color: kind === 'primary' ? '#fff' : c.board, fontWeight: '600', fontSize: 16 }}>{label}</Text>
  </Pressable>;

export const Banner = ({ tone, text }: { tone: 'warn' | 'info'; text: string }) =>
  <View style={{ backgroundColor: tone === 'warn' ? c.warnBg : c.infoBg, borderRadius: r.sm, padding: s.md, marginBottom: s.md }}>
    <Text style={{ color: tone === 'warn' ? c.warn : c.info, fontSize: 13 }}>{text}</Text>
  </View>;

export const Field = ({ label, value, onChange, keyboard, hint }:
  { label: string; value: string; onChange: (v: string) => void; keyboard?: 'numeric' | 'default'; hint?: string }) =>
  <View style={{ marginBottom: s.md }}>
    <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 4 }}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} keyboardType={keyboard ?? 'default'}
      style={{ minHeight: 48, borderWidth: 1, borderColor: c.line, borderRadius: r.md, paddingHorizontal: s.md, backgroundColor: '#fff', fontSize: 16 }} />
    {hint ? <Text style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{hint}</Text> : null}
  </View>;

export const Chips = ({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) =>
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s.sm, marginBottom: s.md }}>
    {options.map(o => (
      <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button" accessibilityState={{ selected: o === value }}
        style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1,
          borderColor: o === value ? c.board : c.line, backgroundColor: o === value ? c.boardLight : '#fff' }}>
        <Text style={{ color: o === value ? c.board : c.text }}>{o}</Text>
      </Pressable>))}
  </View>;

export const hm = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const common = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } });
