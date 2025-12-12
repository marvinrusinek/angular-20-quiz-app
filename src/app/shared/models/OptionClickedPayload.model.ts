import { SelectedOption } from './SelectedOption.model';

export type OptionClickedPayload = {
  option: SelectedOption;
  index: number;
  checked: boolean;
  wasReselected?: boolean;
};
