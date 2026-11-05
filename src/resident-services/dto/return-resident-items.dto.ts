import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { ResidentServiceItemDto } from './confirm-resident-issuance.dto';

export class ReturnResidentItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ResidentServiceItemDto)
  items!: ResidentServiceItemDto[];
}
