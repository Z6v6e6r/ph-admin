import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser, RequestWithUser } from '../rbac/request-user.interface';

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): RequestUser | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  }
);
